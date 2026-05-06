import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { listDirectoryPlanCatalog } from '@/lib/venue-billing';
import { PlanPickerClient } from './PlanPickerClient';

export const dynamic = 'force-dynamic';

export default async function SignupPlanPage() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;

  // Not signed in → back to signup
  if (!venueId) redirect('/signup');

  // Load venue to check existing state
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, owner_first_name, email, directory_plan_id, directory_subscription_status, directory_plans(is_legacy)',
    )
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) redirect('/signup');

  // Legacy-plan venues bypass subscription entirely — send straight to dashboard
  const planData = (venue as Record<string, unknown>).directory_plans as { is_legacy?: boolean } | null;
  if (planData?.is_legacy === true) redirect('/dashboard');

  // Already has an active subscription → skip ahead to dashboard
  const liveStatus = (venue as Record<string, unknown>).directory_subscription_status as string | null;
  if (liveStatus === 'active' || liveStatus === 'trialing') {
    redirect('/dashboard');
  }

  // Fetch plan catalog. The catalog comes back ascending by price; for the
  // picker we want the highest-tier paid plan first (so prospects see the
  // strongest offer up top), then descending paid plans, with the free
  // plan(s) pushed to the end.
  const catalog = await listDirectoryPlanCatalog({ publicOnly: true });
  const paid = catalog
    .filter((p) => (p.price_monthly_cents ?? 0) > 0)
    .sort(
      (a, b) => (b.price_monthly_cents ?? 0) - (a.price_monthly_cents ?? 0),
    );
  const free = catalog.filter((p) => (p.price_monthly_cents ?? 0) === 0);
  const plans = [...paid, ...free];

  // Compute per-plan addon inclusion flags so the picker can display correctly
  const planAddonInclusion: Record<string, { verified: boolean; sponsored: boolean }> = {};
  for (const p of plans) {
    const ff = p.feature_flags as Record<string, unknown>;
    planAddonInclusion[p.id] = {
      verified:  Boolean(ff.addon_verified_included  ?? ff.directory_addon_verified_included),
      sponsored: Boolean(ff.addon_sponsored_included ?? ff.directory_addon_sponsored_included),
    };
  }

  const venueName = (venue as Record<string, unknown>).name as string | null ?? '';
  const ownerFirstName = (venue as Record<string, unknown>).owner_first_name as string | null ?? '';

  // If any public plan has hide_header = true, the picker renders as a
  // standalone landing page (no step header / logo bar).  Useful for
  // direct-link marketing campaigns.
  const hideHeader = plans.some((p) => p.hide_header);

  return (
    <PlanPickerClient
      plans={plans}
      allPlans={plans}
      planAddonInclusion={planAddonInclusion}
      venueName={venueName}
      ownerFirstName={ownerFirstName}
      hideHeader={hideHeader}
    />
  );
}
