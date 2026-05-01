/**
 * POST /api/webhooks/lunarpay
 *
 * Two responsibilities:
 *  1. Per-venue merchant onboarding: merchant.approved / merchant.denied events
 *     persist the venue's lp_sk_ / lp_pk_ keys so they can accept payments.
 *  2. Platform SaaS billing: subscription/charge events for venues subscribed
 *     to a directory plan are forwarded to handleLunarPayWebhookForPlatformLedger,
 *     which inserts cash events and flips directory_subscription_status to
 *     past_due/canceled when LunarPay reports failures or cancellations.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { handleLunarPayWebhookForPlatformLedger } from '@/lib/platform-directory-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const WEBHOOK_SECRET = process.env.LUNARPAY_WEBHOOK_SECRET ?? '';

function verify(rawBody: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return true; // skip verification if secret not configured (dev)
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-lunarpay-signature') ?? '';

  if (!verify(rawBody, signature)) {
    console.warn('[webhooks/lunarpay] invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  type Payload = {
    event: string;
    merchant: { id: number; email: string; businessName?: string; organizationId?: number };
    onboarding: { status: string };
    keys?: { publishableKey: string; secretKey: string };
  };

  let payload: Payload;
  try {
    payload = JSON.parse(rawBody) as Payload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { event, merchant, onboarding, keys } = payload;
  console.log('[webhooks/lunarpay]', event, merchant?.id);

  if (event === 'merchant.approved' && keys?.secretKey && keys?.publishableKey) {
    // Find the venue by merchantId
    const { data: venues } = await supabaseAdmin
      .from('venues')
      .select('id')
      .eq('lunarpay_merchant_id', merchant.id)
      .limit(1);

    const venueId = (venues as { id: string }[] | null)?.[0]?.id;
    if (venueId) {
      await supabaseAdmin
        .from('venues')
        .update({
          lunarpay_secret_key:       keys.secretKey,
          lunarpay_publishable_key:  keys.publishableKey,
          onboarding_status: 'active',
        })
        .eq('id', venueId);
      console.log('[webhooks/lunarpay] venue activated', venueId);
    }
  }

  if (event === 'merchant.denied') {
    const { data: venues } = await supabaseAdmin
      .from('venues')
      .select('id')
      .eq('lunarpay_merchant_id', merchant.id)
      .limit(1);
    const venueId = (venues as { id: string }[] | null)?.[0]?.id;
    if (venueId) {
      await supabaseAdmin
        .from('venues')
        .update({ onboarding_status: `denied_${onboarding.status.toLowerCase()}` })
        .eq('id', venueId);
    }
  }

  // Forward all non-merchant events to the platform SaaS ledger handler so
  // subscription cycles, payment failures, and cancellations from LunarPay
  // update the venue's billing status + insert cash events automatically.
  // Best-effort: never let a ledger error block the 200 we owe LunarPay.
  if (!event.startsWith('merchant.')) {
    try {
      await handleLunarPayWebhookForPlatformLedger(payload as unknown as Record<string, unknown>);
    } catch (err) {
      console.error('[webhooks/lunarpay] platform ledger error', err);
    }
  }

  return NextResponse.json({ received: true });
}
