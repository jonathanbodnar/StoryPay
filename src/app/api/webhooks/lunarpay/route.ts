import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';

const LP_WEBHOOK_SECRET = process.env.LP_WEBHOOK_SECRET || '';

function verifySignature(payload: string, signature: string): boolean {
  if (!LP_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', LP_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

interface WebhookPayload {
  event: string;
  merchant: {
    id: number;
    email: string;
    name?: string;
    businessName?: string;
    organizationId?: number;
  };
  keys?: {
    publishableKey: string;
    secretKey: string;
  };
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-lunarpay-signature') || '';

  if (LP_WEBHOOK_SECRET && signature) {
    if (!verifySignature(rawBody, signature)) {
      console.error('[lunarpay-webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { event, merchant, keys } = payload;

  if (!event || !merchant?.id) {
    return NextResponse.json({ error: 'Missing event or merchant data' }, { status: 400 });
  }

  console.log(`[lunarpay-webhook] event=${event} merchantId=${merchant.id} email=${merchant.email}`);

  const { data: venue, error: findError } = await supabaseAdmin
    .from('venues')
    .select('id, onboarding_status')
    .eq('lunarpay_merchant_id', merchant.id)
    .single();

  if (findError || !venue) {
    console.error(`[lunarpay-webhook] No venue found for merchantId=${merchant.id}`);
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  if (event === 'merchant.approved') {
    const updateData: Record<string, unknown> = {
      onboarding_status: 'active',
    };

    if (keys?.secretKey) {
      updateData.lunarpay_secret_key = keys.secretKey;
    }
    if (keys?.publishableKey) {
      updateData.lunarpay_publishable_key = keys.publishableKey;
    }

    const { error: updateError } = await supabaseAdmin
      .from('venues')
      .update(updateData)
      .eq('id', venue.id);

    if (updateError) {
      console.error(`[lunarpay-webhook] DB update failed for venue=${venue.id}:`, updateError.message);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }

    console.log(`[lunarpay-webhook] Venue ${venue.id} marked as active`);
  } else if (event === 'merchant.denied') {
    await supabaseAdmin
      .from('venues')
      .update({ onboarding_status: 'denied' })
      .eq('id', venue.id);

    console.log(`[lunarpay-webhook] Venue ${venue.id} marked as denied`);
  } else {
    console.log(`[lunarpay-webhook] Unhandled event: ${event}`);
  }

  return NextResponse.json({ received: true });
}
