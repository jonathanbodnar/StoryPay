/**
 * POST /api/webhooks/stripe-connect
 *
 * Stripe events from venues' own Stripe accounts (Stripe Connect,
 * lib/stripe/connect-webhooks.ts). Verified with STRIPE_CONNECT_WEBHOOK_SECRET
 * against the raw body; anything unsigned is rejected. A handler error returns
 * 500 so Stripe retries.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { handleConnectEvent } from '@/lib/stripe/connect-webhooks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim();
  if (!secret || !isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe Connect webhooks are not configured' }, { status: 503 });
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  const rawBody = await request.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    console.warn('[webhooks/stripe-connect] invalid signature:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    await handleConnectEvent(event);
  } catch (e) {
    console.error('[webhooks/stripe-connect] handler failed:', event.type, event.id, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
