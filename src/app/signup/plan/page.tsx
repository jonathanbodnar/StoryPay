import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { listDirectoryPlanCatalog } from '@/lib/venue-billing';
import { computeMonthlyTotalCents } from '@/lib/directory-addons';
import { PlanPickerClient } from './PlanPickerClient';
import type { DirectoryPlanCatalogEntry } from '@/lib/venue-billing';

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
      'id, name, owner_first_name, email, directory_plan_id, directory_subscription_status',
    )
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) redirect('/signup');

  // Already has an active subscription → skip ahead to dashboard
  const liveStatus = (venue as Record<string, unknown>).directory_subscription_status as string | null;
  if (liveStatus === 'active' || liveStatus === 'trialing') {
    redirect('/dashboard');
  }

  // Fetch plan catalog
  const plans = await listDirectoryPlanCatalog();

  // Compute per-plan addon inclusion flags so the picker can display correctly
  const allPlans = plans;
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

  return (
    <PlanPickerClient
      plans={plans}
      allPlans={allPlans}
      planAddonInclusion={planAddonInclusion}
      venueName={venueName}
      ownerFirstName={ownerFirstName}
    />
  );
}
