import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { computeAllowedNavIdsFromPlan } from '@/lib/directory-plans-venue';

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

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select(
      'directory_verified_status, directory_sponsored_status, directory_plan_id',
    )
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  // Resolve whether this plan includes verified/sponsored at no extra charge.
  // Legacy (no plan) → treat as included so they don't get an unexpected upsell.
  let verifiedIncluded = true;
  let sponsoredIncluded = true;
  let planName: string | null = null;
  let isHighestPlan = false;

  const planId = venue.directory_plan_id as string | null | undefined;
  if (planId) {
    const { data: plan } = await supabaseAdmin
      .from('directory_plans')
      .select('name, price_monthly_cents, nav_permissions, feature_flags')
      .eq('id', planId)
      .maybeSingle();

    if (plan) {
      planName = (plan.name as string | null) ?? null;
      const allowed = new Set(
        computeAllowedNavIdsFromPlan({
          feature_flags: plan.feature_flags as Record<string, boolean> | null,
          nav_permissions: plan.nav_permissions as Record<string, boolean> | null,
        }),
      );
      // We consider verified/sponsored "included" when the plan grants the
      // nav_listing_directory permission AND is our premium tier.
      // The highest tier check: if nav_listing_pricing_guide is also granted
      // (that's the marketing-tier gated item) we treat the plan as highest.
      isHighestPlan =
        allowed.has('nav_listing_directory') &&
        allowed.has('nav_listing_pricing_guide');
      verifiedIncluded = isHighestPlan;
      sponsoredIncluded = isHighestPlan;
    } else {
      // Plan id set but plan row missing — fail closed on inclusion.
      verifiedIncluded = false;
      sponsoredIncluded = false;
    }
  }

  return NextResponse.json({
    directory_verified_status: (venue.directory_verified_status as string | null) ?? 'none',
    directory_sponsored_status: (venue.directory_sponsored_status as string | null) ?? 'none',
    verifiedIncluded,
    sponsoredIncluded,
    isHighestPlan,
    planName,
  });
}
