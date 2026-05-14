import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  requirePlatformLunarPaySecretKey,
} from '@/lib/platform-directory-billing';
import {
  cancelSubscription,
  createSubscription,
  getCheckoutSession,
  listSubscriptions,
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
 * Called from /signup/plan/complete after LunarPay redirects back.
 *
 * Flow (mirrors proposals/public/[token]/verify-payment):
 *  1. Idempotency — if venue already has a directory sub, return ok.
 *  2. Fetch the LP checkout session; require status="completed".
 *  3. Extract customer_id and payment_method_id from the session.
 *     If LP didn't surface them directly (known LP API gap), fall back
 *     to listSubscriptions to find the subscription LP auto-created.
 *  4. Cancel the $1/month subscription LP created at checkout time.
 *  5. Best-effort refund the $1 validation charge.
 *  6. Create the real recurring subscription with
 *     startOn = directory_trial_ends_at (first real charge after 14 days).
 *  7. Mark the venue as trialing + stamp the new subscription id.
 */
export async function POST(req: NextRequest) {
  // Top-level catch: guarantees this handler always returns JSON regardless
  // of which line throws. Without this, Next.js returns an HTML error page
  // which res.json() can't parse — client shows "Network error" and the
  // real cause is hidden. This wrapper surfaces every failure to both the
  // user and Railway logs.
  try {
    return await verifyHandler(req);
  } catch (err) {
    console.error('[signup-checkout/verify] UNCAUGHT EXCEPTION:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Unexpected server error: ${msg}` },
      { status: 500 },
    );
  }
}

async function verifyHandler(req: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { session_id?: string };
  const sessionId = body.session_id;
  if (!sessionId) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });

  let secret: string;
  try {
    secret = requirePlatformLunarPaySecretKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[signup-checkout/verify] HQ key not configured:', msg);
    return NextResponse.json(
      { error: 'Billing is not configured. Please contact support.' },
      { status: 503 },
    );
  }

  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // ── Idempotency ─────────────────────────────────────────────────────────
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

  // ── Fetch checkout session ───────────────────────────────────────────────
  let session: Record<string, unknown>;
  try {
    const result = (await getCheckoutSession(secret, sessionId)) as Record<string, unknown>;
    session = (result.data as Record<string, unknown>) || result;
  } catch (e) {
    console.error('[signup-checkout/verify] getCheckoutSession failed:', e);
    return NextResponse.json(
      { error: 'Could not look up your payment session. Please contact support.' },
      { status: 502 },
    );
  }

  console.log('[signup-checkout/verify] session status:', session.status, 'session_id:', sessionId);

  if (session.status !== 'completed') {
    return NextResponse.json(
      { error: `Checkout not completed (status: ${String(session.status)})` },
      { status: 400 },
    );
  }

  // ── Extract customer + payment method from session ──────────────────────
  // LP subscription-mode sessions expose these fields. Try all known shapes.
  let customerId: string | number | null =
    (session.customer_id as string | number | null) ||
    (session.customerId as string | number | null) ||
    ctx.venue.platform_lunarpay_customer_id ||
    null;

  let paymentMethodId: string | number | null =
    (session.payment_method_id as string | number | null) ||
    (session.paymentMethodId as string | number | null) ||
    (session.payment_method as string | number | null) ||
    null;

  // LP subscription_id — may or may not be on the session GET response.
  let validationSubId: string | number | null =
    (session.subscription_id as string | number | null) ||
    (session.subscriptionId as string | number | null) ||
    ((session.subscription as Record<string, unknown> | null)?.id as string | number | null | undefined) ||
    null;

  // LP charge id for the $1 validation payment — used for the refund.
  const sessionCharge =
    (session.charge as Record<string, unknown> | null) || null;
  const sessionCharges = Array.isArray(session.charges) ? session.charges : null;
  const firstCharge = sessionCharges
    ? (sessionCharges[0] as Record<string, unknown> | undefined)
    : undefined;
  const chargeIdFromSession: string | number | null =
    (session.charge_id as string | number | null) ??
    (session.chargeId as string | number | null) ??
    (sessionCharge?.id as string | number | null | undefined) ??
    (firstCharge?.id as string | number | null | undefined) ??
    (session.transaction_id as string | number | null | undefined) ??
    (session.transactionId as string | number | null | undefined) ??
    null;

  console.log('[signup-checkout/verify] from session — customerId:', customerId,
    'paymentMethodId:', paymentMethodId, 'validationSubId:', validationSubId,
    'chargeId:', chargeIdFromSession);

  // ── Fallback: find the validation subscription via listSubscriptions ─────
  // LP sometimes does not surface subscription_id / customer_id in the
  // session GET response. Mirror the strategy used in proposals/verify-payment.
  if (!validationSubId && customerId) {
    try {
      const allSubs = await listSubscriptions(secret);
      const subList: Record<string, unknown>[] = Array.isArray(allSubs)
        ? allSubs
        : ((allSubs as Record<string, unknown>).data as Record<string, unknown>[]) ?? [];
      const match = subList.find(
        (s) =>
          String(s.customer_id ?? s.customerId ?? s.donorId ?? s.donor_id) === String(customerId) &&
          s.status !== 'cancelled' &&
          s.status !== 'canceled',
      );
      if (match?.id) {
        validationSubId = match.id as string | number;
        if (!paymentMethodId) {
          paymentMethodId =
            (match.paymentMethodId as string | number | null) ??
            (match.payment_method_id as string | number | null) ??
            (match.payment_method as string | number | null) ??
            null;
        }
        console.log('[signup-checkout/verify] found validation sub via list:', validationSubId);
      }
    } catch (e) {
      console.warn('[signup-checkout/verify] listSubscriptions fallback failed:', e);
    }
  }

  // If we still have no customer / payment method we truly cannot proceed.
  if (!customerId || !paymentMethodId) {
    console.error(
      '[signup-checkout/verify] cannot proceed — missing customer or payment method after all fallbacks',
      { customerId, paymentMethodId, validationSubId, sessionId },
    );
    return NextResponse.json(
      {
        error:
          'Your card was processed but we could not retrieve the payment details needed to activate your trial. Please contact support — reference session ' +
          sessionId,
      },
      { status: 502 },
    );
  }

  // ── Read plan + trial context from venue row ─────────────────────────────
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
    return NextResponse.json({ error: 'Plan was not pre-assigned for this venue.' }, { status: 400 });
  }
  if (!trialEndsAt) {
    return NextResponse.json({ error: 'Trial end date missing on this venue.' }, { status: 400 });
  }

  // Recompute the real monthly billing amount.
  const [allPlans, addonPrices] = await Promise.all([
    listDirectoryPlanCatalog(),
    loadAddonPrices(),
  ]);
  const targetPlan = allPlans.find((p) => p.id === planId);
  if (!targetPlan) {
    return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });
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
    return NextResponse.json({ error: 'Computed monthly total is $0.' }, { status: 400 });
  }

  // ── Cancel the $1/month validation subscription LP created ───────────────
  if (validationSubId !== null) {
    try {
      await cancelSubscription(secret, validationSubId);
      console.log('[signup-checkout/verify] canceled $1 validation sub', validationSubId);
    } catch (e) {
      console.warn('[signup-checkout/verify] cancel validation sub failed (non-fatal):', e);
    }
  } else {
    console.warn('[signup-checkout/verify] no validation sub id — cannot cancel $1 sub; session:', sessionId);
  }

  // ── Refund the $1 validation charge (best-effort) ────────────────────────
  if (chargeIdFromSession !== null) {
    try {
      await refundCharge(secret, chargeIdFromSession);
      console.log('[signup-checkout/verify] refunded $1 validation charge', chargeIdFromSession);
    } catch (e) {
      console.warn('[signup-checkout/verify] refund of $1 charge failed (non-fatal):', e);
    }
  } else {
    console.warn('[signup-checkout/verify] no charge id on session — manual refund may be needed; session:', sessionId);
  }

  // ── Create the real deferred subscription ───────────────────────────────
  const trialEndYmd = trialEndsAt.slice(0, 10);
  let newSubId: string | number | null = null;
  try {
    const subResult = (await createSubscription(secret, {
      customerId:      Number(customerId),
      paymentMethodId: Number(paymentMethodId),
      amount:          charge.total_cents,
      frequency:       'monthly',
      startOn:         trialEndYmd,
      description:     `StoryVenue — ${targetPlan.name} (monthly, first charge ${trialEndYmd})`,
    })) as Record<string, unknown>;
    const sub = (subResult.data as Record<string, unknown>) || subResult;
    newSubId = (sub.id as string | number | undefined) ?? null;
    console.log('[signup-checkout/verify] created real sub', newSubId, 'startOn', trialEndYmd);
  } catch (e) {
    console.error('[signup-checkout/verify] createSubscription failed:', e);
    return NextResponse.json(
      {
        error:
          'Your card was verified and the $1 charge refunded, but we could not schedule your subscription. Please contact support — reference session ' +
          sessionId,
      },
      { status: 502 },
    );
  }

  if (newSubId === null) {
    return NextResponse.json(
      { error: 'LunarPay did not return a subscription id.' },
      { status: 502 },
    );
  }

  // ── Persist all state to the venue row ──────────────────────────────────
  await supabaseAdmin
    .from('venues')
    .update({
      directory_plan_id:                  planId,
      directory_subscription_status:      'trialing',
      directory_subscription_external_id: String(newSubId),
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

  // ── Audit log ────────────────────────────────────────────────────────────
  await supabaseAdmin.from('platform_billing_events').insert({
    venue_id:          venueId,
    directory_plan_id: planId,
    amount_cents:      0,
    currency:          'usd',
    external_event_id: `signup_plan:${sessionId}`,
    event_type:        'subscription_signup_trial_start',
    metadata: {
      session_id:               sessionId,
      validation_sub_id:        validationSubId !== null ? String(validationSubId) : null,
      new_subscription_id:      String(newSubId),
      validation_charge_id:     chargeIdFromSession !== null ? String(chargeIdFromSession) : null,
      trial_ends_at:            trialEndsAt,
      monthly_cents:            charge.total_cents,
      flow:                     'signup_trial_v3',
      addon_verified:           addonVerified,
      addon_sponsored:          addonSponsored,
      addon_concierge:          addonConcierge,
    },
  });

  return NextResponse.json({
    ok: true,
    subscription_id: String(newSubId),
    trial_ends_at:   trialEndsAt,
  });
}
