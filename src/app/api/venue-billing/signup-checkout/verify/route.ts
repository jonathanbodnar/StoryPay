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
  getSubscription,
  listPaymentMethods,
  listSubscriptions,
  updateSubscription,
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
 * With native LP trial mode (mode:"subscription" + recurring.trial:true):
 *  1. LP tokenizes and saves the card — NO charge, NO $1 hold.
 *  2. LP auto-creates the subscription with nextPaymentOn = start_on.
 *  3. Session status is "trial_started" (not "completed").
 *  4. Session.resources.subscription_id contains the auto-created sub ID.
 *
 * This route reads the subscription ID from the session and persists it.
 * If LP didn't return the ID in resources, we fall back to listSubscriptions.
 * As a last resort, we create the subscription manually via the LP API.
 */
export async function POST(req: NextRequest) {
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

export async function GET() {
  return NextResponse.json({ ok: true, route: 'signup-checkout/verify', ts: Date.now() });
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
      { status: 422 },
    );
  }

  console.log('[signup-checkout/verify] session status:', session.status, 'session_id:', sessionId);

  // LP trial sessions return "trial_started" instead of "completed".
  // Accept both so the route works regardless of LP version.
  const sessionStatus = String(session.status ?? '');
  if (sessionStatus !== 'completed' && sessionStatus !== 'trial_started') {
    return NextResponse.json(
      { error: `Checkout not completed (status: ${sessionStatus})` },
      { status: 400 },
    );
  }

  // ── Extract subscription_id from session ─────────────────────────────────
  // With mode:"subscription" + trial, LP auto-creates the subscription and
  // returns the ID in session.resources.subscription_id.
  const resources = (session.resources as Record<string, unknown> | null) ?? null;
  let newSubId: string | number | null =
    (resources?.subscription_id as string | number | null) ??
    (session.subscription_id as string | number | null) ??
    (session.subscriptionId as string | number | null) ??
    null;

  // Also extract customer_id for fallback lookups
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

  console.log('[signup-checkout/verify] from session — subId:', newSubId,
    'customerId:', customerId, 'paymentMethodId:', paymentMethodId);

  // ── Fallback: find subscription via listSubscriptions ────────────────────
  if (!newSubId) {
    try {
      const allSubs = await listSubscriptions(secret);
      const subList: Record<string, unknown>[] = Array.isArray(allSubs)
        ? allSubs
        : ((allSubs as Record<string, unknown>).data as Record<string, unknown>[]) ?? [];
      const match = subList.find(
        (s) =>
          (customerId
            ? String(s.customer_id ?? s.customerId ?? s.donorId ?? s.donor_id) === String(customerId)
            : true) &&
          s.status !== 'cancelled' &&
          s.status !== 'canceled',
      );
      if (match?.id) {
        newSubId = match.id as string | number;
        if (!customerId)
          customerId =
            (match.customer_id as string | number | null) ??
            (match.customerId as string | number | null) ??
            null;
        if (!paymentMethodId)
          paymentMethodId =
            (match.payment_method_id as string | number | null) ??
            (match.paymentMethodId as string | number | null) ??
            (match.payment_method as string | number | null) ??
            null;
        console.log('[signup-checkout/verify] found sub via listSubscriptions:', newSubId);
      }
    } catch (e) {
      console.warn('[signup-checkout/verify] listSubscriptions fallback failed:', e);
    }
  }

  // ── Get payment method detail if missing ─────────────────────────────────
  if (newSubId && !paymentMethodId) {
    try {
      const subDetail = (await getSubscription(secret, newSubId)) as Record<string, unknown>;
      const sd = (subDetail.data as Record<string, unknown>) || subDetail;
      paymentMethodId =
        (sd.payment_method_id as string | number | null) ??
        (sd.paymentMethodId as string | number | null) ??
        (sd.payment_method as string | number | null) ??
        null;
      if (!customerId)
        customerId =
          (sd.customer_id as string | number | null) ??
          (sd.customerId as string | number | null) ??
          null;
    } catch (e) {
      console.warn('[signup-checkout/verify] getSubscription fallback failed:', e);
    }
  }

  if (customerId && !paymentMethodId) {
    try {
      const pmResult = (await listPaymentMethods(secret, Number(customerId))) as Record<string, unknown>;
      const pmList: Record<string, unknown>[] = Array.isArray(pmResult)
        ? pmResult
        : ((pmResult.data as Record<string, unknown>[]) ?? []);
      const defaultPm = pmList.find((p) => p.isDefault || p.is_default || p.default);
      const pickedPm = defaultPm ?? pmList[pmList.length - 1] ?? null;
      if (pickedPm?.id) {
        paymentMethodId = pickedPm.id as string | number;
      }
    } catch (e) {
      console.warn('[signup-checkout/verify] listPaymentMethods fallback failed:', e);
    }
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

  // ── If LP didn't auto-create a subscription, create one manually ─────────
  if (!newSubId) {
    console.warn('[signup-checkout/verify] no subscription from LP — creating manually');

    if (!customerId || !paymentMethodId) {
      console.error('[signup-checkout/verify] cannot create sub — missing customer or PM',
        { customerId, paymentMethodId, sessionId });
      return NextResponse.json(
        {
          error:
            'Your card was saved but we could not retrieve the payment details needed to activate your trial. Please contact support — reference session ' +
            sessionId,
        },
        { status: 422 },
      );
    }

    const trialEndYmd = trialEndsAt.slice(0, 10);
    try {
      const startOnIso = `${trialEndYmd}T12:00:00.000Z`;
      const subPayload: Record<string, unknown> = {
        customerId:      Number(customerId),
        paymentMethodId: Number(paymentMethodId),
        amount:          Math.round(charge.total_cents),
        frequency:       'monthly',
        startOn:         startOnIso,
        description:     `StoryVenue — ${targetPlan.name} (monthly, first charge ${trialEndYmd})`,
      };
      console.log('[signup-checkout/verify] createSubscription payload:', JSON.stringify(subPayload));

      const subResult = (await createSubscription(secret, subPayload)) as Record<string, unknown>;
      const sub = (subResult.data as Record<string, unknown>) || subResult;
      newSubId = (sub.id as string | number | undefined) ?? null;
      console.log('[signup-checkout/verify] created sub manually:', newSubId);
    } catch (e) {
      console.error('[signup-checkout/verify] createSubscription failed:', e);
      return NextResponse.json(
        {
          error:
            'Your card was saved but we could not schedule your subscription. Please contact support — reference session ' +
            sessionId,
        },
        { status: 422 },
      );
    }
  }

  if (newSubId === null) {
    return NextResponse.json(
      { error: 'LunarPay did not return a subscription id.' },
      { status: 422 },
    );
  }

  // ── Align LP's nextPaymentOn with our 14-day trial end date ──────────────
  // We send the checkout without `start_on` (LP's hosted page chokes on it
  // in trial mode), so LP defaults nextPaymentOn to ~1 frequency period.
  // PATCH it to our actual trial end so the first real charge lands on day 14.
  try {
    const startOnIso = trialEndsAt.length === 10
      ? `${trialEndsAt}T12:00:00.000Z`
      : trialEndsAt;
    await updateSubscription(secret, newSubId, { nextPaymentOn: startOnIso });
    console.log('[signup-checkout/verify] PATCHed sub nextPaymentOn to', startOnIso);
  } catch (e) {
    console.warn('[signup-checkout/verify] failed to PATCH nextPaymentOn:', e);
    // Non-fatal: customer's trial is still active, first charge just lands
    // ~16 days later than our recorded end date.
  }

  // ── Persist all state to the venue row ──────────────────────────────────
  await supabaseAdmin
    .from('venues')
    .update({
      directory_plan_id:                  planId,
      directory_subscription_status:      'trialing',
      directory_subscription_external_id: String(newSubId),
      platform_lunarpay_customer_id:      customerId ? String(customerId) : undefined,
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
      new_subscription_id:      String(newSubId),
      trial_ends_at:            trialEndsAt,
      monthly_cents:            charge.total_cents,
      flow:                     'signup_trial_native',
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