import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  requirePlatformLunarPaySecretKey,
} from '@/lib/platform-directory-billing';
import { createSubscription, getCheckoutSession } from '@/lib/lunarpay';
import { computeMonthlyTotalCents } from '@/lib/directory-addons';
import { listDirectoryPlanCatalog, loadAddonPrices } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/signup-checkout/verify
 * Body: { session_id: string }
 *
 * Called from /signup/plan/complete after LunarPay redirects back.
 * 1. Validates the completed checkout session.
 * 2. Creates a LunarPay subscription with startOn = trial_ends_at (14 days).
 * 3. Writes trial + subscription state to the venues row.
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

  // Fetch and validate the checkout session
  const result = (await getCheckoutSession(secret, sessionId)) as Record<string, unknown>;
  const session = (result.data as Record<string, unknown>) || result;

    if (session.status !== 'completed') {
      return NextResponse.json(
        { error: `Checkout not completed (status: ${String(session.status)})` },
        { status: 400 },
      );
    }

    // Extract customer and payment method from the completed session.
    const customerId =
      (session.customer_id as string | number | null) ||
      (session.customerId as string | number | null) ||
      ctx.venue.platform_lunarpay_customer_id;
    const paymentMethodId =
      (session.payment_method_id as string | number | null) ||
      (session.paymentMethodId as string | number | null) ||
      (session.payment_method as string | number | null);

    if (!customerId || !paymentMethodId) {
      return NextResponse.json(
        { error: 'Missing customer or payment method from checkout' },
        { status: 400 },
      );
    }

    // Read context from the venue row instead of session.metadata. The
    // metadata round-trip via LunarPay is unreliable (LP returns 500 when
    // metadata is present, May 2026), so signup-checkout writes plan +
    // addons + trial dates to the venue row before redirecting.
    const { data: venueRow } = await supabaseAdmin
      .from('venues')
      .select(
        'directory_plan_id, directory_addon_verified, directory_addon_sponsored, directory_addon_concierge, directory_trial_ends_at',
      )
      .eq('id', venueId)
      .maybeSingle();
    const vr = (venueRow ?? {}) as Record<string, unknown>;
    const planId         = String(vr.directory_plan_id ?? '');
    const addonVerified  = Boolean(vr.directory_addon_verified);
    const addonSponsored = Boolean(vr.directory_addon_sponsored);
    const addonConcierge = Boolean(vr.directory_addon_concierge);
    const trialEndsAtRaw = String(vr.directory_trial_ends_at ?? '');

    if (!planId) {
      return NextResponse.json(
        { error: 'Plan was not pre-assigned for this venue.' },
        { status: 400 },
      );
    }

  // Compute charge amount with dynamic prices
  const [allPlans, addonPrices] = await Promise.all([
    listDirectoryPlanCatalog(),
    loadAddonPrices(),
  ]);
  const targetPlan = allPlans.find((p) => p.id === planId) ?? null;
  if (!targetPlan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 400 });
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
    return NextResponse.json({ error: 'Nothing to bill' }, { status: 400 });
  }

  // The subscription starts when the trial ends (14 days from signup)
  const today = new Date();
  let startOn = today.toISOString().slice(0, 10);
  if (trialEndsAtRaw) {
    const endsDate = new Date(trialEndsAtRaw);
    if (!Number.isNaN(endsDate.getTime()) && endsDate.getTime() > today.getTime()) {
      startOn = endsDate.toISOString().slice(0, 10);
    }
  }

  // Create subscription in LunarPay
  const subResult = (await createSubscription(secret, {
    customerId:      Number(customerId),
    paymentMethodId: Number(paymentMethodId),
    amount:          charge.total_cents,
    frequency:       'monthly',
    startOn,
    description:     `StoryVenue — ${targetPlan.name}`,
  })) as Record<string, unknown>;
  const sub = (subResult.data as Record<string, unknown>) || subResult;
  const subId = (sub.id as string | number | undefined) ?? null;
  if (subId === null) {
    return NextResponse.json({ error: 'LunarPay did not return a subscription id' }, { status: 502 });
  }

  // Persist all state to venues row
  const now = new Date();
  const trialStartedAt = now.toISOString();
  const trialEndsAt = trialEndsAtRaw || new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

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

  // Log the billing event
  await supabaseAdmin.from('platform_billing_events').insert({
    venue_id:        venueId,
    directory_plan_id: planId,
    amount_cents:    charge.total_cents,
    currency:        'usd',
    external_event_id: `signup_plan:${sessionId}`,
    event_type:      'subscription_signup_trial_start',
    metadata: {
      session_id:      sessionId,
      subscription_id: String(subId),
      start_on:        startOn,
      trial_ends_at:   trialEndsAt,
      addon_verified:  addonVerified,
      addon_sponsored: addonSponsored,
    },
  });

  return NextResponse.json({
    ok: true,
    subscription_id: String(subId),
    total_cents:     charge.total_cents,
    start_on:        startOn,
  });
}
