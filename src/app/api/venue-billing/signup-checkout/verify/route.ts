import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  requirePlatformLunarPaySecretKey,
} from '@/lib/platform-directory-billing';
import { getCheckoutSession } from '@/lib/lunarpay';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/signup-checkout/verify
 * Body: { session_id: string }
 *
 * Called from /signup/plan/complete after LunarPay redirects back.
 *
 * The signup-checkout now uses mode:"subscription" with a deferred
 * start_date (= trial_ends_at). LP vaults the card and creates the
 * subscription automatically — no manual createSubscription call needed.
 * All we do here is read the subscription_id from the session and persist
 * the trial + subscription state to the venues row.
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

  // LP subscription-mode sessions include the subscription ID directly.
  const subId =
    (session.subscription_id as string | number | null) ??
    (session.subscriptionId as string | number | null) ??
    ((session.subscription as Record<string, unknown> | null)?.id as string | number | null | undefined) ??
    null;

  const customerId =
    (session.customer_id as string | number | null) ||
    (session.customerId as string | number | null) ||
    ctx.venue.platform_lunarpay_customer_id;

  if (subId === null) {
    return NextResponse.json(
      { error: 'LunarPay session did not return a subscription_id — expected mode:subscription' },
      { status: 502 },
    );
  }

  // Read trial + plan context from the venue row (pre-assigned by
  // signup-checkout/route.ts before the LP redirect).
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

  // Persist all state to venues row
  await supabaseAdmin
    .from('venues')
    .update({
      directory_plan_id:                  planId,
      directory_subscription_status:      'trialing',
      directory_subscription_external_id: String(subId),
      platform_lunarpay_customer_id:      customerId ? String(customerId) : undefined,
      directory_trial_started_at:         trialStartedAt,
      directory_trial_ends_at:            trialEndsAt || undefined,
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
    venue_id:          venueId,
    directory_plan_id: planId,
    amount_cents:      0,
    currency:          'usd',
    external_event_id: `signup_plan:${sessionId}`,
    event_type:        'subscription_signup_trial_start',
    metadata: {
      session_id:      sessionId,
      subscription_id: String(subId),
      trial_ends_at:   trialEndsAt,
      mode:            'subscription',
      addon_verified:  addonVerified,
      addon_sponsored: addonSponsored,
      addon_concierge: addonConcierge,
    },
  });

  return NextResponse.json({
    ok: true,
    subscription_id: String(subId),
    trial_ends_at:   trialEndsAt,
  });
}
