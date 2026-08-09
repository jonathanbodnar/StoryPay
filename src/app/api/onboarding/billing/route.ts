/**
 * POST /api/onboarding/billing
 *
 * Decides whether the Publish step must collect a card before going live, and
 * makes sure the venue is set up so the existing inline Fortis Elements flow
 * (/payment-intent → signup-checkout/confirm) works.
 *
 * Returns:
 *   { needsCard: false, alreadyActive: true }   — card already on file
 *   { needsCard: false, devSkip: true }         — billing not configured (dev only)
 *   { needsCard: false, noPaidPlan: true }      — no paid plan to sell (dev only)
 *   { needsCard: true, planName, amountCents, trialEndsAt } — show the form
 *   503 { error }                               — production misconfiguration; the
 *                                                 gate is held rather than bypassed
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

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * The card gate must fail closed. Every "skip the card" branch below is a
 * misconfiguration (missing HQ key, empty plan catalog) rather than a real
 * business state, so in production we hold the venue with a visible error
 * instead of quietly letting them go live for free — a silent bypass leaks
 * revenue with nothing to alert on. Locally these stay soft skips so dev
 * doesn't need LunarPay credentials.
 */
function holdGate(reason: string): NextResponse | null {
  if (!IS_PROD) return null;
  console.error(`[onboarding/billing] card gate held — ${reason}`);
  return NextResponse.json(
    {
      error:
        'Billing is temporarily unavailable, so we can’t finish setting up your listing. Please try again in a few minutes or contact clients@storyvenue.com.',
    },
    { status: 503 },
  );
}

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

  // Card already vaulted (incl. Free-plan onboarders on a $0 plan) → the card
  // requirement is met; never re-prompt. Tolerant of pre-migration schemas.
  {
    const { data: cardRow } = await supabaseAdmin
      .from('venues')
      .select('directory_card_on_file')
      .eq('id', venueId)
      .maybeSingle();
    if (cardRow && (cardRow as { directory_card_on_file?: boolean }).directory_card_on_file === true) {
      return NextResponse.json({ needsCard: false, alreadyActive: true });
    }
  }

  // Billing not wired up. In local dev this is expected; in production it means
  // STORYPAY_HQ_LUNARPAY_SK is missing and every venue would sail past the card.
  if (!isPlatformDirectoryBillingConfigured()) {
    const held = holdGate('STORYPAY_HQ_LUNARPAY_SK is not configured');
    if (held) return held;
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
    const held = holdGate('no paid plan exists in the catalog to assign');
    if (held) return held;
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

  // Not reachable while `target` comes from paidPlans (price > 0), but kept as
  // a backstop in case addon/plan pricing ever nets out to zero.
  if (charge.total_cents <= 0) {
    const held = holdGate(`computed monthly total was ${charge.total_cents} for plan ${target.id}`);
    if (held) return held;
    return NextResponse.json({ needsCard: false, noPaidPlan: true });
  }

  return NextResponse.json({
    needsCard: true,
    planName: target.name,
    amountCents: charge.total_cents,
    trialEndsAt,
  });
}
