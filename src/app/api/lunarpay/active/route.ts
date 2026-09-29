/**
 * GET /api/lunarpay/active
 *
 * Lightweight check: can this venue take payments? DB only (no outbound call),
 * so the sidebar and page guards can call it freely.
 *
 * Covers both processors: an approved LunarPay merchant, or a venue whose own
 * Stripe account can take payments (Stripe Connect). A venue with Stripe
 * payments available is never shown the StoryPay "paused" state; it sets up
 * Stripe instead.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { isStoryPayPaused } from '@/lib/storypay-pause';
import { stripeConnectAvailableFor, venueTakesStripePayments, type ConnectVenue } from '@/lib/stripe/connect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ active: false, status: 'unauthorized', paused: false });

  const { data } = await supabaseAdmin
    .from('venues')
    .select('id, onboarding_status, lunarpay_merchant_id, slug, email, notification_email, stripe_account_id, stripe_account_status, stripe_charges_enabled, payments_provider')
    .eq('id', venueId)
    .maybeSingle();

  const row = data as (Pick<ConnectVenue, 'id' | 'slug' | 'email' | 'notification_email' | 'stripe_account_id' | 'stripe_account_status' | 'stripe_charges_enabled' | 'payments_provider'> & {
    onboarding_status?: string | null;
  }) | null;
  const status = row?.onboarding_status ?? null;
  const lunarPayActive = status === 'active';
  const stripeActive = row ? venueTakesStripePayments(row) : false;
  const stripeAvailable = row ? stripeConnectAvailableFor(row) : false;
  const active = lunarPayActive || stripeActive;

  return NextResponse.json({
    active,
    status: status ?? (active ? 'active' : 'not_started'),
    provider: stripeActive ? 'stripe' : lunarPayActive ? 'lunarpay' : null,
    // Signup is paused for this venue (exempt venues keep full access). Venues
    // that can use Stripe are never paused.
    paused: !stripeAvailable && !stripeActive && isStoryPayPaused(row?.slug),
    stripe: {
      available: stripeAvailable,
      status: row?.stripe_account_status ?? 'none',
      chargesEnabled: row?.stripe_charges_enabled === true,
    },
  });
}
