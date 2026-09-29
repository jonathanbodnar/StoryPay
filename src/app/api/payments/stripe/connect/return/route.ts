/**
 * GET /api/payments/stripe/connect/return
 *
 * Where Stripe's hosted signup sends the venue back. Returning doesn't mean
 * signup is complete, so read the account from Stripe, then land on Payment
 * settings, which shows what (if anything) is still needed.
 */
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { syncConnectedAccount } from '@/lib/stripe/connect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${APP_URL}/login?next=/dashboard/payments/settings`);
  let result = 'return';
  try {
    const state = await syncConnectedAccount(user.venueId);
    result = state.chargesEnabled ? 'active' : state.actionRequired ? 'incomplete' : 'pending';
  } catch (e) {
    console.error('[payments/stripe/connect/return]', e instanceof Error ? e.message : e);
  }
  return NextResponse.redirect(`${APP_URL}/dashboard/payments/settings?stripe=${result}`);
}
