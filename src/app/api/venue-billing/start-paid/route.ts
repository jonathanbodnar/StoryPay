import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  requirePlatformLunarPaySecretKey,
  STORYPAY_PLATFORM_DIRECTORY_META_KEY,
} from '@/lib/platform-directory-billing';
import { createCheckoutSession } from '@/lib/lunarpay';
import { computeMonthlyTotalCents } from '@/lib/directory-addons';
import { listDirectoryPlanCatalog, loadAddonPrices } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';

/**
 * POST /api/venue-billing/start-paid
 *
 * Used to add a card to an account that's currently on:
 *   • An active trial (status='trialing') — sets up billing for trial end
 *   • An expired trial (status='trial_expired') — bills today, on demand
 *
 * Returns a LunarPay checkout URL. After successful checkout, the
 * /api/venue-billing/start-paid/verify endpoint creates the subscription
 * with startOn = directory_trial_ends_at (or today if already expired).
 *
 * Free-forever trials never need this endpoint — they don't auto-bill.
 */
export async function POST() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  if (!ctx.plan) {
    return NextResponse.json({ error: 'No directory plan assigned' }, { status: 400 });
  }

  // Pull addons + trial state.
  const { data: row } = await supabaseAdmin
    .from('venues')
    .select(
      'directory_addon_verified, directory_addon_sponsored, directory_trial_ends_at, directory_trial_is_forever',
    )
    .eq('id', venueId)
    .maybeSingle();
  const r = (row ?? {}) as Record<string, unknown>;
  const addonVerifiedUser = Boolean(r.directory_addon_verified);
  const addonSponsoredUser = Boolean(r.directory_addon_sponsored);
  const trialIsForever = Boolean(r.directory_trial_is_forever);
  const trialEndsAt = (r.directory_trial_ends_at as string | null) ?? null;

  if (trialIsForever) {
    return NextResponse.json(
      { error: 'This venue is on a perpetual free trial — no payment needed.' },
      { status: 400 },
    );
  }

  const [allPlans, addonPrices] = await Promise.all([
    listDirectoryPlanCatalog(),
    loadAddonPrices(),
  ]);
  const currentPlan = allPlans.find((p) => p.id === ctx.venue.directory_plan_id) ?? null;
  const charge = computeMonthlyTotalCents({
    plan: currentPlan,
    allPlans,
    addonVerifiedUser,
    addonSponsoredUser,
    prices: addonPrices,
  });
  if (charge.total_cents <= 0) {
    return NextResponse.json(
      { error: 'Nothing to bill — total monthly is $0.' },
      { status: 400 },
    );
  }

  const secret = requirePlatformLunarPaySecretKey();
  const checkoutData: Record<string, unknown> = {
    amount: charge.total_cents / 100,
    description: `StoryVenue directory — ${currentPlan?.name ?? 'subscription'} (monthly)`,
    customer_email: ctx.venue.email || undefined,
    customer_name: ctx.venue.name,
    success_url: `${APP_URL}/dashboard/directory-billing?start_paid=1`,
    cancel_url: `${APP_URL}/dashboard/directory-billing`,
    metadata: {
      [STORYPAY_PLATFORM_DIRECTORY_META_KEY]: '1',
      venue_id: venueId,
      directory_plan_id: currentPlan?.id ?? null,
      addon_verified: addonVerifiedUser ? '1' : '0',
      addon_sponsored: addonSponsoredUser ? '1' : '0',
      trial_ends_at: trialEndsAt ?? '',
      action: 'start_paid_after_trial',
    },
  };

  try {
    const result = await createCheckoutSession(secret, checkoutData);
    const session = (result as { data?: { url?: string }; url?: string }).data || result;
    const url = (session as { url?: string }).url;
    if (!url) throw new Error('LunarPay did not return a checkout URL');
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not create checkout session';
    console.error('[start-paid] LunarPay error:', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
