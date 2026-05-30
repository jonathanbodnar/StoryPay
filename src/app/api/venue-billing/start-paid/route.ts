import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadVenueDirectoryPlanContext,
  requirePlatformLunarPaySecretKey,
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
      'directory_addon_verified, directory_addon_sponsored, directory_trial_is_forever, directory_trial_ends_at',
    )
    .eq('id', venueId)
    .maybeSingle();
  const r = (row ?? {}) as Record<string, unknown>;
  const addonVerifiedUser = Boolean(r.directory_addon_verified);
  const addonSponsoredUser = Boolean(r.directory_addon_sponsored);
  const trialIsForever = Boolean(r.directory_trial_is_forever);

  // When a venue adds a card while their trial is still running ("start early"),
  // the first charge must still land on the trial-end date — not today. Pass
  // recurring.start_on so LunarPay schedules the first payment for then. If the
  // trial has already expired (the post-trial wall), omit start_on so billing
  // begins immediately.
  let trialEndStartOn: string | null = null;
  const trialEndsRaw = r.directory_trial_ends_at as string | null | undefined;
  if (trialEndsRaw) {
    const ends = new Date(trialEndsRaw);
    if (!Number.isNaN(ends.getTime()) && ends.getTime() > Date.now()) {
      trialEndStartOn = ends.toISOString().slice(0, 10); // YYYY-MM-DD
    }
  }

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

  // Use mode:"subscription" so LP charges the card, vaults it, and creates
  // the recurring subscription in one call. The verify route just reads the
  // subscription ID from the completed session — no manual createSubscription.
  const secret = requirePlatformLunarPaySecretKey();
  const checkoutData: Record<string, unknown> = {
    amount: charge.total_cents / 100,
    description: `StoryVenue directory — ${currentPlan?.name ?? 'subscription'} (monthly)`,
    mode: 'subscription',
    recurring: trialEndStartOn
      ? { frequency: 'monthly', start_on: trialEndStartOn }
      : { frequency: 'monthly' },
    customer_email: ctx.venue.email || undefined,
    customer_name: ctx.venue.name,
    payment_methods: ['cc'],
    metadata: {
      storypay_venue_id: venueId,
      storypay_plan_id: ctx.venue.directory_plan_id,
      flow: 'start_paid',
    },
    success_url: `${APP_URL}/dashboard/directory-billing?start_paid=1`,
    cancel_url: `${APP_URL}/dashboard/directory-billing`,
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
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
