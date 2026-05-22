import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  isPlatformDirectoryBillingConfigured,
} from '@/lib/platform-directory-billing';
import { computeMonthlyTotalCents } from '@/lib/directory-addons';
import { listDirectoryPlanCatalog, loadAddonPrices } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SIGNUP_TRIAL_DAYS = 14;

/**
 * POST /api/venue-billing/signup-checkout
 *
 * Called during the post-signup onboarding flow when the user picks a plan.
 *
 * 1. Assigns the selected plan to the venue.
 * 2. For free plans ($0 total): returns { redirect: '/signup/success?plan=free' }
 *    immediately without requiring a card.
 * 3. For paid plans: creates a LunarPay checkout session with mode:"subscription"
 *    and recurring.trial:true so the card is vaulted but NOT charged. The first
 *    recurring charge fires on recurring.start_on (trial end date).
 *
 * LP trial behavior (per developer docs):
 *   - Card is tokenized and saved (NO charge, NO $1 hold)
 *   - Subscription is created with nextPaymentOn = start_on date
 *   - Session status returns "trial_started" instead of "succeeded"
 *   - Webhook fires checkout.session.completed with transaction.amount = 0
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

  // Assign plan + addons to venue.
  // Also set the directory badge status fields so the admin portal reflects
  // the purchased addons immediately (admin reads *_status, not *_addon_*).
  try {
    await supabaseAdmin
      .from('venues')
      .update({
        directory_plan_id:          planId,
        directory_addon_verified:   addonVerified,
        directory_addon_sponsored:  addonSponsored,
        directory_addon_concierge:  addonConcierge,
        // When a venue pays for verified/sponsored, activate the badge status
        // so it shows as live in the admin and on the directory listing.
        // Only set to 'approved' if the addon is being selected; preserve the
        // existing value otherwise by omitting the field when not selected.
        ...(addonVerified  ? { directory_verified_status:  'approved' } : {}),
        ...(addonSponsored ? { directory_sponsored_status: 'approved' } : {}),
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

    return NextResponse.json({ redirect: '/signup/success?plan=free' });
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
    return NextResponse.json({ redirect: '/signup/success?plan=paid' });
  }

  // Compute trial end date and persist it on the venue row BEFORE checkout.
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

  // Plan saved, trial dates persisted — tell the frontend to show the
  // inline Fortis Elements payment form (no LP hosted page redirect).
  return NextResponse.json({
    nextStep:    'payment',
    amountCents: charge.total_cents,
    trialEndsAt: trialEndsAtIso,
  });
}