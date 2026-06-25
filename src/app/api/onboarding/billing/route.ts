/**
 * POST /api/onboarding/billing
 *
 * Decides whether the Publish step must collect a card before going live, and
 * makes sure the venue is set up so the existing inline Fortis Elements flow
 * (/payment-intent → signup-checkout/confirm) works.
 *
 * Returns:
 *   { needsCard: false, alreadyActive: true }   — card already on file
 *   { needsCard: false, devSkip: true }         — billing not configured (dev)
 *   { needsCard: false, noPaidPlan: true }      — no paid plan exists to sell
 *   { needsCard: true, planName, amountCents, trialEndsAt } — show the form
 *
 * When needsCard is true we (idempotently) assign the target paid plan + a
 * 14-day trial window so /payment-intent and /signup-checkout/confirm can read
 * directory_plan_id + directory_trial_ends_at off the venue row.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  isPlatformDirectoryBillingConfigured,
} from '@/lib/platform-directory-billing';
import { listDirectoryPlanCatalog, loadAddonPrices } from '@/lib/venue-billing';
import { computeMonthlyTotalCents } from '@/lib/directory-addons';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TRIAL_DAYS = 14;

export async function POST(): Promise<NextResponse> {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  const venue = ctx.venue as Record<string, unknown>;

  // Already paying / trialing with a vaulted card → never ask again.
  const subStatus = String(venue.directory_subscription_status ?? '');
  const subExternal = String(venue.directory_subscription_external_id ?? '');
  if (subExternal && ['trialing', 'active', 'past_due'].includes(subStatus)) {
    return NextResponse.json({ needsCard: false, alreadyActive: true });
  }

  // Billing not wired up (local dev) — don't block publishing.
  if (!isPlatformDirectoryBillingConfigured()) {
    return NextResponse.json({ needsCard: false, devSkip: true });
  }

  const [allPlans, addonPrices] = await Promise.all([
    listDirectoryPlanCatalog(),
    loadAddonPrices(),
  ]);

  // Target plan: keep the currently-assigned plan if it's paid, else the
  // default paid plan, else the cheapest paid plan.
  const currentId = String(venue.directory_plan_id ?? '');
  const paidPlans = allPlans.filter((p) => (p.price_monthly_cents ?? 0) > 0);
  const target =
    paidPlans.find((p) => p.id === currentId) ??
    paidPlans.find((p) => p.is_default) ??
    [...paidPlans].sort((a, b) => (a.price_monthly_cents ?? 0) - (b.price_monthly_cents ?? 0))[0] ??
    null;

  if (!target) {
    return NextResponse.json({ needsCard: false, noPaidPlan: true });
  }

  // Ensure plan + trial dates exist so the inline flow can read them.
  const now = new Date();
  let trialEndsAt = String(venue.directory_trial_ends_at ?? '');
  if (currentId !== target.id || !trialEndsAt) {
    const end = new Date(now);
    end.setDate(end.getDate() + TRIAL_DAYS);
    trialEndsAt = end.toISOString();
    await supabaseAdmin
      .from('venues')
      .update({
        directory_plan_id: target.id,
        directory_trial_started_at: now.toISOString(),
        directory_trial_ends_at: trialEndsAt,
        directory_trial_plan_id: target.id,
      })
      .eq('id', venueId);
  }

  const charge = computeMonthlyTotalCents({
    plan: target,
    allPlans,
    addonVerifiedUser: Boolean(venue.directory_addon_verified),
    addonSponsoredUser: Boolean(venue.directory_addon_sponsored),
    addonConciergeUser: Boolean(venue.directory_addon_concierge),
    prices: addonPrices,
  });

  if (charge.total_cents <= 0) {
    return NextResponse.json({ needsCard: false, noPaidPlan: true });
  }

  return NextResponse.json({
    needsCard: true,
    planName: target.name,
    amountCents: charge.total_cents,
    trialEndsAt,
  });
}
