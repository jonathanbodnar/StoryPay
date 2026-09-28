/**
 * POST /api/webhooks/stripe
 *
 * Stripe events for StoryVenue SaaS billing on the owner's Stripe account
 * (lib/stripe/webhooks.ts). Verified with STRIPE_WEBHOOK_SECRET against the raw
 * body; anything unsigned is rejected. Each event is processed once
 * (stripe_events). A handler error returns 500 so Stripe retries.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { handleStripeEvent } from '@/lib/stripe/webhooks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe webhooks are not configured' }, { status: 503 });
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  const rawBody = await request.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    console.warn('[webhooks/stripe] invalid signature:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    await handleStripeEvent(event);
  } catch (e) {
    console.error('[webhooks/stripe] handler failed:', event.type, event.id, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
