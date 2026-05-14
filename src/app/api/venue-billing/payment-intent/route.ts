import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  loadVenueDirectoryPlanContext,
  getPlatformLunarPayPublishableKey,
} from '@/lib/platform-directory-billing';
import { createIntention } from '@/lib/lunarpay';
import { computeMonthlyTotalCents } from '@/lib/directory-addons';
import { listDirectoryPlanCatalog, loadAddonPrices } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/payment-intent
 *
 * Creates a Fortis Elements intention for the SaaS trial signup flow.
 * Uses savePaymentMethod:true (no charge today — trial).
 * Returns { clientToken, environment, amountCents, trialEndsAt }.
 */
export async function POST() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const venueRow = ctx.venue as Record<string, unknown>;
  const trialEndsAt = String(venueRow.directory_trial_ends_at ?? '');
  const planId      = String(venueRow.directory_plan_id ?? '');

  if (!trialEndsAt || !planId) {
    return NextResponse.json({ error: 'Plan not set up yet. Please go back and pick a plan.' }, { status: 400 });
  }

  const pk = getPlatformLunarPayPublishableKey();
  if (!pk) {
    return NextResponse.json({ error: 'Payment system not configured. Please contact support.' }, { status: 503 });
  }

  // Recompute monthly total to show accurate amount
  const [allPlans, addonPrices] = await Promise.all([
    listDirectoryPlanCatalog(),
    loadAddonPrices(),
  ]);
  const targetPlan = allPlans.find((p) => p.id === planId);
  if (!targetPlan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const charge = computeMonthlyTotalCents({
    plan:              targetPlan,
    allPlans,
    addonVerifiedUser:  Boolean((ctx.venue as Record<string, unknown>).directory_addon_verified),
    addonSponsoredUser: Boolean((ctx.venue as Record<string, unknown>).directory_addon_sponsored),
    addonConciergeUser: Boolean((ctx.venue as Record<string, unknown>).directory_addon_concierge),
    prices:            addonPrices,
  });

  try {
    const result = await createIntention(pk, undefined, {
      savePaymentMethod: true,
      paymentMethods:    ['cc'],
    });
    const intention = (result as Record<string, unknown>).data || result;

    return NextResponse.json({
      clientToken:  (intention as Record<string, unknown>).clientToken,
      environment:  (intention as Record<string, unknown>).environment ?? 'production',
      amountCents:  charge.total_cents,
      trialEndsAt,
    });
  } catch (err) {
    console.error('[venue-billing/payment-intent]', err);
    return NextResponse.json({ error: 'Failed to initialize payment form' }, { status: 500 });
  }
}
