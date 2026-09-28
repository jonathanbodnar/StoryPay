/**
 * POST /api/venue-billing/stripe/move-to-stripe
 *
 * Self-serve move for a venue still billed on LunarPay whose card isn't in the
 * owner's Stripe account: opens a Stripe-hosted page to save a card. On return
 * (and via the webhook) lib/stripe/lunarpay-migration.ts starts the Stripe
 * subscription on the date LunarPay would next have charged and cancels
 * LunarPay — or charges now when the LunarPay payment is already past due.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createCardUpdateCheckout, loadBillingVenue } from '@/lib/stripe/billing';
import { isStripeConfigured } from '@/lib/stripe/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isStripeConfigured()) return NextResponse.json({ error: 'Billing update is not available yet.' }, { status: 503 });

  const v = await loadBillingVenue(venueId);
  if (!v) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  if (v.billing_provider !== 'lunarpay') {
    return NextResponse.json({ error: 'Your billing is already up to date.' }, { status: 409 });
  }
  try {
    const { url } = await createCardUpdateCheckout(venueId, '/dashboard/directory-billing', 'lp_move');
    return NextResponse.json({ url });
  } catch (e) {
    console.error('[stripe/move-to-stripe]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not start the card update.' }, { status: 500 });
  }
}
