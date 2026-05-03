import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { listDirectoryPlanCatalog, loadAddonPrices } from '@/lib/venue-billing';
import { AddonsClient } from './AddonsClient';

export const dynamic = 'force-dynamic';

export default async function SignupAddonsPage({
  searchParams,
}: {
  searchParams: Promise<{ plan_id?: string }>;
}) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) redirect('/signup');

  const params = await searchParams;
  const planId = params.plan_id?.trim();
  if (!planId) redirect('/signup/plan');

  // Verify venue exists and isn't already subscribed
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, owner_first_name, directory_subscription_status')
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) redirect('/signup');

  const liveStatus = (venue as Record<string, unknown>).directory_subscription_status as string | null;
  if (liveStatus === 'active' || liveStatus === 'trialing') redirect('/dashboard');

  // Load full catalog + addon prices in parallel
  const [catalog, addonPrices] = await Promise.all([
    listDirectoryPlanCatalog(),
    loadAddonPrices(),
  ]);

  const selectedPlan = catalog.find((p) => p.id === planId);
  if (!selectedPlan) redirect('/signup/plan');

  // Resolve which addons are bundled into the selected plan
  const ff = selectedPlan.feature_flags as Record<string, unknown>;
  const inclusion = {
    verified:  Boolean(ff.addon_verified_included  ?? ff.directory_addon_verified_included),
    sponsored: Boolean(ff.addon_sponsored_included ?? ff.directory_addon_sponsored_included),
    concierge: Boolean(ff.addon_concierge_included),
  };
  const conciergeAvailable = Boolean(ff.addon_concierge_available);

  return (
    <AddonsClient
      planId={planId}
      planName={selectedPlan.name}
      planPriceCents={selectedPlan.price_monthly_cents ?? 0}
      inclusion={inclusion}
      conciergeAvailable={conciergeAvailable}
      addonPrices={addonPrices}
      ownerFirstName={
        (venue as Record<string, unknown>).owner_first_name as string ?? ''
      }
    />
  );
}
