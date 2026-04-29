/**
 * POST /api/webhooks/lunarpay
 *
 * Receives merchant.approved / merchant.denied events from LunarPay.
 * On approval: stores the merchant's lp_sk_ and lp_pk_ keys and marks
 * the venue as active so payments can begin immediately.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

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

  return NextResponse.json({ received: true });
}
