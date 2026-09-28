/**
 * GET /api/venue-billing/stripe/checkout-return?session_id=…&next=/path
 *
 * Where Stripe-hosted Checkout sends the venue back. Applies the finished
 * session right away (the webhook does the same thing, idempotently) so the
 * dashboard never shows a stale wall while the webhook is in flight, then
 * redirects to `next`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { applyCheckoutSession } from '@/lib/stripe/billing';

export const dynamic = 'force-dynamic';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
export const runtime = 'nodejs';

function safeNext(raw: string | null): string {
  const v = (raw ?? '').trim();
  return v.startsWith('/') && !v.startsWith('//') ? v : '/dashboard/directory-billing';
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id') ?? '';
  const next = safeNext(url.searchParams.get('next'));
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;

  let ok = false;
  if (sessionId.startsWith('cs_') && venueId) {
    try {
      const applied = await applyCheckoutSession(sessionId);
      ok = applied.venueId === venueId;
    } catch (e) {
      console.error('[stripe/checkout-return]', e instanceof Error ? e.message : e);
    }
  }
  // Behind Railway's proxy request.url's origin can be internal — use the app URL.
  const dest = new URL(next, APP_URL);
  dest.searchParams.set('billing', ok ? 'updated' : 'pending');
  return NextResponse.redirect(dest);
}
