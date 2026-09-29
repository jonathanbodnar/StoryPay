/**
 * /api/payments/stripe/connect — the venue's own Stripe account for taking
 * couple payments (Stripe Connect, lib/stripe/connect.ts).
 *
 *   GET  → current status (synced from Stripe when an account exists)
 *   POST → { url } of Stripe's hosted signup, to start or finish it
 *
 * Owners and admins only; the signup link is single-use and never emailed.
 */
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import {
  createOnboardingLink,
  feeTierFor,
  loadConnectVenue,
  loadFeeTiers,
  stripeConnectAvailableFor,
  syncConnectedAccount,
  type ConnectVenue,
} from '@/lib/stripe/connect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** What the venue pays per payment, as shown on the setup panel (Stripe's 2.9% + 30¢ included). */
async function feesFor(v: ConnectVenue): Promise<{ cardPercent: number; bankPercent: number }> {
  const rates = (await loadFeeTiers())[await feeTierFor(v)];
  const card = v.payment_fee_card_percent != null ? Number(v.payment_fee_card_percent) : rates.card_fee_percent;
  const bank = v.payment_fee_bank_percent != null ? Number(v.payment_fee_bank_percent) : rates.bank_total_percent;
  return { cardPercent: Math.round((2.9 + card) * 100) / 100, bankPercent: bank };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const v = await loadConnectVenue(user.venueId);
    if (!v) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    const fees = await feesFor(v);
    if (!v.stripe_account_id) {
      return NextResponse.json({ available: stripeConnectAvailableFor(v), status: 'none', chargesEnabled: false, actionRequired: false, fees });
    }
    const state = await syncConnectedAccount(user.venueId);
    return NextResponse.json({ ...state, fees });
  } catch (e) {
    console.error('[payments/stripe/connect] status failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not load your Stripe account status.' }, { status: 502 });
  }
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Only the venue owner or an admin can set up payments.' }, { status: 403 });
  try {
    return NextResponse.json({ url: await createOnboardingLink(user.venueId) });
  } catch (e) {
    console.error('[payments/stripe/connect] link failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not open Stripe.' }, { status: 500 });
  }
}
