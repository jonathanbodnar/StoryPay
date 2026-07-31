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

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, owner_first_name, directory_subscription_status')
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) redirect('/signup');

  const liveStatus = (venue as Record<string, unknown>).directory_subscription_status as string | null;
  if (liveStatus === 'active' || liveStatus === 'trialing') redirect('/dashboard');

  const [catalog, addonPrices] = await Promise.all([
    listDirectoryPlanCatalog(),
    loadAddonPrices(),
  ]);

  const selectedPlan = catalog.find((p) => p.id === planId);
  if (!selectedPlan) redirect('/signup/plan');

  // Force all add-ons off — add-on selection is not shown to users.
  const inclusion = { verified: false, sponsored: false, concierge: false };

  return (
    <AddonsClient
      planId={planId}
      planName={selectedPlan.name}
      planPriceCents={selectedPlan.price_monthly_cents ?? 0}
      inclusion={inclusion}
      conciergeAvailable={false}
      addonPrices={addonPrices}
      ownerFirstName={(venue as Record<string, unknown>).owner_first_name as string ?? ''}
    />
  );
}
