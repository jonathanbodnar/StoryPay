import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  requirePlatformLunarPaySecretKey,
} from '@/lib/platform-directory-billing';
import {
  createSubscription,
  getCheckoutSession,
  refundCharge,
} from '@/lib/lunarpay';
import { computeMonthlyTotalCents } from '@/lib/directory-addons';
import { listDirectoryPlanCatalog, loadAddonPrices } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/signup-checkout/verify
 * Body: { session_id: string }
 *
 * Called from /signup/plan/complete after LunarPay redirects back from
 * the $1 card-validation checkout.
 *
 * Steps:
 *   1. Idempotency guard — if the venue already has a directory
 *      subscription (i.e. this verify already ran), return ok.
 *   2. Fetch the LP checkout session; require status="completed".
 *   3. Pull customer_id, payment_method_id, and charge_id off the session.
 *   4. Best-effort refund of the $1 validation charge.
 *   5. Create a real recurring subscription with
 *      `startOn = directory_trial_ends_at` so the first real charge fires
 *      only after the 14-day trial.
 *   6. Mark the venue as `trialing` and stamp the new subscription id.
 */
export async function POST(req: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { session_id?: string };
  const sessionId = body.session_id;
  if (!sessionId) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });

  const secret = requirePlatformLunarPaySecretKey();
  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // ── Idempotency ─────────────────────────────────────────────────────────
  // If this verify already ran (page reload, double-fetch, retry button),
  // the venue row will already have a directory subscription id stamped
  // and status='trialing'. Short-circuit so we don't try to refund a
  // refund or create a duplicate subscription.
  if (
    ctx.venue.directory_subscription_external_id &&
    ctx.venue.directory_subscription_status === 'trialing'
  ) {
    return NextResponse.json({
      ok: true,
      subscription_id: ctx.venue.directory_subscription_external_id,
      already_processed: true,
    });
  }

  // ── Fetch session ───────────────────────────────────────────────────────
  let session: Record<string, unknown>;
  try {
    const result = (await getCheckoutSession(secret, sessionId)) as Record<string, unknown>;
    session = (result.data as Record<string, unknown>) || result;
  } catch (e) {
    console.error('[signup-checkout/verify] getCheckoutSession failed:', e);
    return NextResponse.json(
      { error: 'Could not look up your payment. Please contact support.' },
      { status: 502 },
    );
  }

  if (session.status !== 'completed') {
    return NextResponse.json(
      { error: `Checkout not completed (status: ${String(session.status)})` },
      { status: 400 },
    );
  }

  // ── Extract customer + payment method + charge id from session ──────────
  const customerId =
    (session.customer_id as string | number | null) ||
    (session.customerId as string | number | null) ||
    ctx.venue.platform_lunarpay_customer_id;
  const paymentMethodId =
    (session.payment_method_id as string | number | null) ||
    (session.paymentMethodId as string | number | null) ||
    (session.payment_method as string | number | null);

  if (!customerId || !paymentMethodId) {
    console.error(
      '[signup-checkout/verify] Missing customer or payment method on session',
      sessionId,
      { customerId, paymentMethodId },
    );
    return NextResponse.json(
      {
        error:
          'Your card was processed but we could not find it on the session. Please contact support so we can finish setup.',
      },
      { status: 502 },
    );
  }

  // LP returns the validation charge id under one of a few shapes
  // depending on payload version. Mirror proposal-side verify-payment.
  const sessionCharge =
    (session.charge as Record<string, unknown> | null) || null;
  const sessionCharges = Array.isArray(session.charges) ? session.charges : null;
  const firstCharge = sessionCharges
    ? (sessionCharges[0] as Record<string, unknown> | undefined)
    : undefined;
  const chargeIdFromSession =
    (session.charge_id as string | number | null) ??
    (session.chargeId as string | number | null) ??
    (sessionCharge?.id as string | number | null | undefined) ??
    (firstCharge?.id as string | number | null | undefined) ??
    (session.transaction_id as string | number | null | undefined) ??
    (session.transactionId as string | number | null | undefined) ??
    null;

  // ── Read trial + plan context from venue row ────────────────────────────
  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select(
      'directory_plan_id, directory_addon_verified, directory_addon_sponsored, directory_addon_concierge, directory_trial_ends_at, directory_trial_started_at',
    )
    .eq('id', venueId)
    .maybeSingle();
  const vr = (venueRow ?? {}) as Record<string, unknown>;
  const planId         = String(vr.directory_plan_id ?? '');
  const addonVerified  = Boolean(vr.directory_addon_verified);
  const addonSponsored = Boolean(vr.directory_addon_sponsored);
  const addonConcierge = Boolean(vr.directory_addon_concierge);
  const trialEndsAt    = String(vr.directory_trial_ends_at ?? '');
  const trialStartedAt = String(vr.directory_trial_started_at ?? new Date().toISOString());

  if (!planId) {
    return NextResponse.json(
      { error: 'Plan was not pre-assigned for this venue.' },
      { status: 400 },
    );
  }
  if (!trialEndsAt) {
    return NextResponse.json(
      { error: 'Trial end date is missing on this venue.' },
      { status: 400 },
    );
  }

  // Recompute the real monthly amount the same way signup-checkout did,
  // so the subscription bills the correct total — including any add-ons
  // the user picked. (We don't trust session.metadata because LP has
  // historically dropped/altered it.)
  const [allPlans, addonPrices] = await Promise.all([
    listDirectoryPlanCatalog(),
    loadAddonPrices(),
  ]);
  const targetPlan = allPlans.find((p) => p.id === planId);
  if (!targetPlan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }
  const charge = computeMonthlyTotalCents({
    plan: targetPlan,
    allPlans,
    addonVerifiedUser:  addonVerified,
    addonSponsoredUser: addonSponsored,
    addonConciergeUser: addonConcierge,
    prices: addonPrices,
  });
  if (charge.total_cents <= 0) {
    return NextResponse.json(
      { error: 'Computed monthly total is $0; nothing to bill.' },
      { status: 400 },
    );
  }

  // ── Refund the $1 validation charge (best-effort) ───────────────────────
  // If LP didn't surface a charge id we still proceed — the venue may
  // have been charged but a manual refund can be done from the LP
  // dashboard. We never want a refund failure to block onboarding.
  if (chargeIdFromSession != null) {
    try {
      await refundCharge(secret, chargeIdFromSession);
      console.log(
        '[signup-checkout/verify] refunded validation charge',
        chargeIdFromSession,
      );
    } catch (e) {
      console.error(
        '[signup-checkout/verify] refund of validation charge failed (non-fatal):',
        chargeIdFromSession,
        e,
      );
    }
  } else {
    console.warn(
      '[signup-checkout/verify] no charge id on session — manual refund may be required',
      sessionId,
    );
  }

  // ── Create the real recurring subscription with deferred startOn ────────
  const trialEndYmd = trialEndsAt.slice(0, 10);
  let subId: string | number | null = null;
  try {
    const subResult = (await createSubscription(secret, {
      customerId:      Number(customerId),
      paymentMethodId: Number(paymentMethodId),
      amount:          charge.total_cents,
      frequency:       'monthly',
      startOn:         trialEndYmd,
      description:     `StoryVenue — ${targetPlan.name} (monthly subscription, first charge ${trialEndYmd})`,
    })) as Record<string, unknown>;
    const sub = (subResult.data as Record<string, unknown>) || subResult;
    subId = (sub.id as string | number | undefined) ?? null;
  } catch (e) {
    console.error('[signup-checkout/verify] createSubscription failed:', e);
    return NextResponse.json(
      {
        error:
          'We saved your card but could not schedule your trial subscription. Please contact support — your card has been refunded.',
      },
      { status: 502 },
    );
  }

  if (subId === null) {
    return NextResponse.json(
      { error: 'LunarPay did not return a subscription id' },
      { status: 502 },
    );
  }

  // ── Persist all state to venue row ──────────────────────────────────────
  await supabaseAdmin
    .from('venues')
    .update({
      directory_plan_id:                  planId,
      directory_subscription_status:      'trialing',
      directory_subscription_external_id: String(subId),
      platform_lunarpay_customer_id:      String(customerId),
      directory_trial_started_at:         trialStartedAt,
      directory_trial_ends_at:            trialEndsAt,
      directory_trial_is_forever:         false,
      directory_trial_plan_id:            planId,
      directory_trial_consumed:           true,
      directory_addon_verified:           addonVerified,
      directory_addon_sponsored:          addonSponsored,
      directory_addon_concierge:          addonConcierge,
    })
    .eq('id', venueId);

  // ── Log the billing event ───────────────────────────────────────────────
  await supabaseAdmin.from('platform_billing_events').insert({
    venue_id:          venueId,
    directory_plan_id: planId,
    amount_cents:      0,
    currency:          'usd',
    external_event_id: `signup_plan:${sessionId}`,
    event_type:        'subscription_signup_trial_start',
    metadata: {
      session_id:               sessionId,
      subscription_id:          String(subId),
      validation_charge_id:     chargeIdFromSession != null ? String(chargeIdFromSession) : null,
      trial_ends_at:            trialEndsAt,
      monthly_cents:            charge.total_cents,
      flow:                     'signup_trial_v2',
      addon_verified:           addonVerified,
      addon_sponsored:          addonSponsored,
      addon_concierge:          addonConcierge,
    },
  });

  return NextResponse.json({
    ok: true,
    subscription_id: String(subId),
    trial_ends_at:   trialEndsAt,
  });
}
