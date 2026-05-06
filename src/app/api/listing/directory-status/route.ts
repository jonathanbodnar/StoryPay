import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/listing/directory-status
 *
 * Returns the venue's current verified/sponsored badge statuses plus a
 * flag indicating whether those features are included on the current plan
 * (so the Verified & Sponsored page knows whether to show pricing or
 * just the manage flow).
 */
export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Pull addon flags too — fall back gracefully if column isn't present yet.
  const baseSelect = 'directory_verified_status, directory_sponsored_status, directory_plan_id';
  const fullSelect = `${baseSelect}, directory_addon_verified, directory_addon_sponsored`;
  let venue: Record<string, unknown> | null = null;
  let { data: venueWithAddons, error: addonsErr } = await supabaseAdmin
    .from('venues')
    .select(fullSelect)
    .eq('id', venueId)
    .maybeSingle();

  if (addonsErr && /directory_addon_/.test(addonsErr.message)) {
    const { data: fallback } = await supabaseAdmin
      .from('venues')
      .select(baseSelect)
      .eq('id', venueId)
      .maybeSingle();
    venue = (fallback as unknown as Record<string, unknown> | null) ?? null;
  } else {
    venue = (venueWithAddons as unknown as Record<string, unknown> | null) ?? null;
  }

  if (!venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  let planName: string | null = null;
  let verifiedIncluded = false;
  let sponsoredIncluded = false;
  let isLegacyPlan = false;

  const planId = venue.directory_plan_id as string | null | undefined;
  if (planId) {
    // Pull the venue's plan + every other plan so we can do price-tier
    // inference for inclusion. Top paid plan includes both, second paid
    // plan includes verified.
    const [{ data: plan }, { data: allPlans }] = await Promise.all([
      supabaseAdmin
        .from('directory_plans')
        .select('id, name, slug, price_monthly_cents, feature_flags, is_legacy')
        .eq('id', planId)
        .maybeSingle(),
      supabaseAdmin
        .from('directory_plans')
        .select('id, name, price_monthly_cents, feature_flags'),
    ]);

    if (plan) {
      const planRow = plan as Record<string, unknown>;
      planName = (planRow.name as string | null) ?? null;
      isLegacyPlan = Boolean(planRow.is_legacy)
        || String(planRow.name ?? '').toLowerCase().includes('legacy')
        || String(planRow.slug ?? '').toLowerCase().includes('legacy');
      const { planIncludesVerified, planIncludesSponsored } = await import('@/lib/directory-addons');
      verifiedIncluded = planIncludesVerified(
        plan as { id: string; price_monthly_cents: number | null; feature_flags: Record<string, unknown> | null },
        (allPlans ?? []) as Array<{ id: string; price_monthly_cents: number | null; feature_flags: Record<string, unknown> | null }>,
      );
      sponsoredIncluded = planIncludesSponsored(
        plan as { id: string; price_monthly_cents: number | null; feature_flags: Record<string, unknown> | null },
        (allPlans ?? []) as Array<{ id: string; price_monthly_cents: number | null; feature_flags: Record<string, unknown> | null }>,
      );
      // Legacy plans have everything included.
      if (isLegacyPlan) {
        verifiedIncluded = true;
        sponsoredIncluded = true;
      }
    }
  }

  // The user has a paid subscription if either flag is checked, OR the plan
  // includes the addon (in which case it's effectively active for free).
  const addonVerified = Boolean(venue.directory_addon_verified ?? false);
  const addonSponsored = Boolean(venue.directory_addon_sponsored ?? false);

  // For the public-page badge, the "live" check is: plan-included OR
  // user-toggled AND status is 'approved'.
  const isHighestPlan = verifiedIncluded && sponsoredIncluded;

  return NextResponse.json({
    directory_verified_status: (venue.directory_verified_status as string | null) ?? 'none',
    directory_sponsored_status: (venue.directory_sponsored_status as string | null) ?? 'none',
    addonVerified,
    addonSponsored,
    verifiedIncluded,
    sponsoredIncluded,
    isHighestPlan,
    isLegacyPlan,
    planName,
  });
}
