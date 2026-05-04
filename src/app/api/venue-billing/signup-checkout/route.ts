import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  isPlatformDirectoryBillingConfigured,
  requirePlatformLunarPaySecretKey,
} from '@/lib/platform-directory-billing';
import { createCheckoutSession } from '@/lib/lunarpay';
import { computeMonthlyTotalCents } from '@/lib/directory-addons';
import { listDirectoryPlanCatalog, loadAddonPrices } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';

const SIGNUP_TRIAL_DAYS = 14;

/**
 * POST /api/venue-billing/signup-checkout
 *
 * Called during the post-signup onboarding flow when the user picks a plan.
 *
 * 1. Assigns the selected plan to the venue.
 * 2. For free plans ($0 total): returns { redirect: '/dashboard?welcome=1' }
 *    immediately without requiring a card.
 * 3. For paid plans: creates a LunarPay checkout session so the user can
 *    enter their card. The subscription start date is set to 14 days from
 *    now so the first charge fires exactly after the trial period.
 */
export async function POST(req: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { plan_id?: string; addon_verified?: boolean; addon_sponsored?: boolean; addon_concierge?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const planId = body.plan_id?.trim();
  if (!planId) return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });

  const addonVerified  = Boolean(body.addon_verified);
  const addonSponsored = Boolean(body.addon_sponsored);
  const addonConcierge = Boolean(body.addon_concierge);

  // Fetch venue + context
  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Find plan + load dynamic addon prices in parallel
  const [allPlans, addonPrices] = await Promise.all([
    listDirectoryPlanCatalog(),
    loadAddonPrices(),
  ]);
  const targetPlan = allPlans.find((p) => p.id === planId);
  if (!targetPlan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Assign plan + addons to venue
  try {
    await supabaseAdmin
      .from('venues')
      .update({
        directory_plan_id:         planId,
        directory_addon_verified:  addonVerified,
        directory_addon_sponsored: addonSponsored,
        directory_addon_concierge: addonConcierge,
      })
      .eq('id', venueId);
  } catch (e) {
    console.error('[signup-checkout] plan assignment failed:', e);
    return NextResponse.json({ error: 'Could not assign plan. Please try again.' }, { status: 500 });
  }

  // Compute monthly total
  const ff = targetPlan.feature_flags as Record<string, unknown>;
  const planIncludesVerified  = Boolean(ff.addon_verified_included  ?? ff.directory_addon_verified_included);
  const planIncludesSponsored = Boolean(ff.addon_sponsored_included ?? ff.directory_addon_sponsored_included);

  const effectiveVerified  = planIncludesVerified  || addonVerified;
  const effectiveSponsored = planIncludesSponsored || addonSponsored;

  const charge = computeMonthlyTotalCents({
    plan: targetPlan,
    allPlans,
    addonVerifiedUser:  effectiveVerified,
    addonSponsoredUser: effectiveSponsored,
    addonConciergeUser: addonConcierge,
    prices: addonPrices,
  });

  // Free plan — no card needed, grant trial and send to dashboard
  if (charge.total_cents <= 0) {
    const now = new Date();
    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + SIGNUP_TRIAL_DAYS);

    await supabaseAdmin
      .from('venues')
      .update({
        directory_subscription_status: 'trialing',
        directory_trial_started_at:    now.toISOString(),
        directory_trial_ends_at:       trialEndsAt.toISOString(),
        directory_trial_plan_id:       planId,
        directory_trial_consumed:      true,
      })
      .eq('id', venueId);

    return NextResponse.json({ redirect: '/dashboard?welcome=1' });
  }

  // Paid plan — billing must be configured
  if (!isPlatformDirectoryBillingConfigured()) {
    // Billing not wired up (local dev) — skip card step
    const now = new Date();
    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + SIGNUP_TRIAL_DAYS);
    await supabaseAdmin
      .from('venues')
      .update({
        directory_subscription_status: 'trialing',
        directory_trial_started_at:    now.toISOString(),
        directory_trial_ends_at:       trialEndsAt.toISOString(),
        directory_trial_plan_id:       planId,
        directory_trial_consumed:      true,
      })
      .eq('id', venueId);
    return NextResponse.json({ redirect: '/dashboard?welcome=1' });
  }

  // Compute trial end date and persist it on the venue row BEFORE checkout.
  // We used to round-trip this through LunarPay session.metadata, but LP's
  // checkout/sessions endpoint currently 500s when metadata is present
  // (May 2026 schema drift). Reading from the DB at verify time is more
  // reliable anyway.
  const now = new Date();
  const trialEndsAt = new Date(now);
  trialEndsAt.setDate(trialEndsAt.getDate() + SIGNUP_TRIAL_DAYS);
  const trialEndsAtIso = trialEndsAt.toISOString();

  await supabaseAdmin
    .from('venues')
    .update({
      directory_trial_started_at: now.toISOString(),
      directory_trial_ends_at:    trialEndsAtIso,
      directory_trial_plan_id:    planId,
    })
    .eq('id', venueId);

  let secret: string;
  try {
    secret = requirePlatformLunarPaySecretKey();
  } catch (e) {
    console.error('[signup-checkout] missing LunarPay secret:', e);
    return NextResponse.json(
      { error: 'Payments are not yet configured. Please contact support.' },
      { status: 503 },
    );
  }

  // 14-day free trial: charge $1 today purely to verify the card and save it
  // for later. The verify endpoint refunds this charge immediately and then
  // creates a recurring subscription whose first real charge fires on
  // trial_ends_at (14 days out). LunarPay's checkout/sessions endpoint
  // requires a non-zero amount, so $1 is the minimum.
  //
  // Restrict to credit card — ACH micro-deposits take 1-3 business days,
  // which would block trial activation, and a $1 ACH verification refund is
  // an awkward experience compared to a card auth that drops off the
  // statement quickly.
  const checkoutData: Record<string, unknown> = {
    amount:          1,
    description:     `StoryVenue — ${targetPlan.name} (14-day free trial — $1 card verification, refunded after signup)`,
    customer_email:  ctx.venue.email || undefined,
    customer_name:   ctx.venue.name,
    payment_methods: ['cc'],
    success_url:     `${APP_URL}/signup/plan/complete?checkout=1`,
    cancel_url:      `${APP_URL}/signup/addons?plan_id=${planId}`,
  };

  // LunarPay can throw on network failures, invalid keys, validation errors,
  // etc.  Surface a user-friendly message instead of letting Next.js return a
  // generic 500 — which is what was breaking the signup flow before.
  try {
    const result = await createCheckoutSession(secret, checkoutData);
    const session = (result as { data?: { url?: string }; url?: string }).data || result;
    const url = (session as { url?: string }).url;
    if (!url) {
      console.error('[signup-checkout] checkout session missing url:', result);
      return NextResponse.json(
        { error: 'Could not create checkout session. Please try again.' },
        { status: 502 },
      );
    }
    return NextResponse.json({ url });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[signup-checkout] LunarPay error:', message, e);
    return NextResponse.json(
      { error: `Could not start checkout: ${message}` },
      { status: 502 },
    );
  }
}
