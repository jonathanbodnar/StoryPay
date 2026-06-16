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
  if (!WEBHOOK_SECRET) return false; // reject all requests if secret is not configured
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
    // Special case: this might be StoryPay HQ — the merchant we use to
    // collect SaaS subscription fees from venues. The HQ merchant is NOT
    // a venue, so don't try to look it up in the venues table. Instead
    // log the keys very loudly so the operator can copy them into Railway
    // as STORYPAY_HQ_LUNARPAY_SK / STORYPAY_HQ_LUNARPAY_PK. (We never write
    // them to the DB — env vars are the source of truth for HQ.)
    const hqMerchantIdEnv = process.env.STORYPAY_HQ_LUNARPAY_MERCHANT_ID?.trim();
    const isHQByEnvId = hqMerchantIdEnv && String(merchant.id) === hqMerchantIdEnv;
    const isHQByName =
      typeof merchant.businessName === 'string' &&
      merchant.businessName.trim().toLowerCase() === 'storypay';

    if (isHQByEnvId || isHQByName) {
      // Redact secret/publishable keys to last 4 chars — full keys must not
      // land in Railway logs (any engineer with log access could see them).
      // To retrieve the full keys, use the LunarPay dashboard directly.
      const skTail = (keys.secretKey || '').slice(-4);
      const pkTail = (keys.publishableKey || '').slice(-4);
      console.warn('=========================================================');
      console.warn('[webhooks/lunarpay] StoryPay HQ MERCHANT APPROVED');
      console.warn(`  merchantId      = ${merchant.id}`);
      console.warn(`  businessName    = ${merchant.businessName}`);
      console.warn(`  organizationId  = ${merchant.organizationId}`);
      console.warn('  → Retrieve keys from LunarPay dashboard and set in Railway env:');
      console.warn(`    STORYPAY_HQ_LUNARPAY_SK = sk_***${skTail}`);
      console.warn(`    STORYPAY_HQ_LUNARPAY_PK = pk_***${pkTail}`);
      console.warn(`    STORYPAY_HQ_LUNARPAY_MERCHANT_ID = ${merchant.id}`);
      console.warn('=========================================================');
      return NextResponse.json({ received: true, role: 'hq' });
    }

    // Otherwise it's a venue merchant — store its keys on its venue row.
    const { data: venues } = await supabaseAdmin
      .from('venues')
      .select('id, lunarpay_secret_key, lunarpay_publishable_key, onboarding_status')
      .eq('lunarpay_merchant_id', merchant.id)
      .limit(1);

    const v = (venues as { id: string; lunarpay_secret_key: string | null; lunarpay_publishable_key: string | null; onboarding_status: string | null }[] | null)?.[0];
    const venueId = v?.id;
    if (venueId) {
      // Idempotency guard: if the venue is already active with the same keys,
      // skip the write entirely so a webhook replay doesn't overwrite a
      // post-rotation key with the original one.
      const sameSk = v?.lunarpay_secret_key === keys.secretKey;
      const samePk = v?.lunarpay_publishable_key === keys.publishableKey;
      const alreadyActive = v?.onboarding_status === 'active';
      if (alreadyActive && sameSk && samePk) {
        console.log('[webhooks/lunarpay] merchant.approved replay ignored for venue', venueId);
      } else {
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
    } else {
      console.warn(
        `[webhooks/lunarpay] merchant.approved for id=${merchant.id} (${merchant.businessName}) but no matching venue — keys NOT stored. If this is StoryPay HQ, set STORYPAY_HQ_LUNARPAY_MERCHANT_ID=${merchant.id} in env so future webhooks recognise it.`,
      );
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
      void (async () => {
        try {
          const { logError } = await import('@/lib/error-log');
          await logError({
            level: 'critical', source: 'webhook', category: 'lunarpay_ledger',
            message: 'LunarPay webhook ledger handler failed',
            error: err, route: '/api/webhooks/lunarpay', context: { event },
          });
        } catch { /* non-critical */ }
      })();
    }
  }

  return NextResponse.json({ received: true });
}
