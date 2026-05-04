import { createCheckoutSession, createSubscription, getCheckoutSession } from '@/lib/lunarpay';
import { supabaseAdmin } from '@/lib/supabase';
import { getPlatformFortisMerchantId } from '@/lib/platform-billing';

/** Checkout + subscription metadata so webhooks can attribute revenue to a venue. */
export const STORYPAY_PLATFORM_DIRECTORY_META_KEY = 'storypay_platform_directory';

/**
 * Returns "StoryPay HQ"'s merchant secret key (lp_sk_...) — the merchant
 * account StoryPay uses to bill its own SaaS subscribers (the venues).
 *
 * Two-role architecture:
 *   • Agency key (lp_agency_..., env: LP_AGENCY_KEY) — used ONLY to register
 *     and onboard new venue merchants via /api/v1/agency/*. Cannot be used
 *     for checkout/charges/subscriptions.
 *   • StoryPay HQ merchant key (lp_sk_..., env: STORYPAY_HQ_LUNARPAY_SK) —
 *     used to bill venues for their StoryPay SaaS subscriptions.
 *   • Each venue's own merchant key (lp_sk_..., column:
 *     venues.lunarpay_secret_key) — used to bill end-clients for proposals
 *     and invoices.
 *
 * STORYPAY_HQ_LUNARPAY_SK is the canonical env var. The old name
 * STORYPAY_PLATFORM_LUNARPAY_SECRET_KEY is honoured for backwards compat
 * during the rename; new deploys should use STORYPAY_HQ_LUNARPAY_SK.
 */
export function getPlatformLunarPaySecretKey(): string | null {
  const raw =
    process.env.STORYPAY_HQ_LUNARPAY_SK?.trim() ||
    process.env.STORYPAY_PLATFORM_LUNARPAY_SECRET_KEY?.trim() ||
    null;
  if (!raw) return null;
  if (!raw.startsWith('lp_sk_')) {
    console.warn(
      '[platform-directory-billing] StoryPay HQ key is set but does not start with "lp_sk_" — agency keys (lp_agency_...) are NOT valid on /api/v1/checkout. Refusing to use it.',
    );
    return null;
  }
  return raw;
}

/** StoryPay HQ's publishable key — for Fortis Elements card-update flows. */
export function getPlatformLunarPayPublishableKey(): string | null {
  const raw =
    process.env.STORYPAY_HQ_LUNARPAY_PK?.trim() ||
    process.env.STORYPAY_PLATFORM_LUNARPAY_PUBLISHABLE_KEY?.trim() ||
    null;
  if (!raw) return null;
  if (!raw.startsWith('lp_pk_')) return null;
  return raw;
}

export function isPlatformDirectoryBillingConfigured(): boolean {
  return Boolean(getPlatformLunarPaySecretKey());
}

export function requirePlatformLunarPaySecretKey(): string {
  const sk = getPlatformLunarPaySecretKey();
  if (!sk) {
    throw new Error(
      'StoryPay HQ billing is not configured. Set STORYPAY_HQ_LUNARPAY_SK to a LunarPay merchant secret key (starts with lp_sk_). Agency keys (lp_agency_...) cannot be used for checkout — they only work on /api/v1/agency/* endpoints. To get the HQ key, onboard "StoryPay" as a merchant via the agency API: see /api/admin/storypay-hq/onboard.',
    );
  }
  return sk;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';

export type VenuePlanRow = {
  venue: {
    id: string;
    name: string;
    email: string | null;
    directory_plan_id: string | null;
    directory_subscription_status: string;
    directory_subscription_external_id: string | null;
    platform_lunarpay_customer_id: string | null;
  };
  plan: {
    id: string;
    name: string;
    price_monthly_cents: number | null;
    fortis_merchant_id: string | null;
  } | null;
};

export async function loadVenueDirectoryPlanContext(venueId: string): Promise<VenuePlanRow | null> {
  const { data: venue, error: vErr } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, email, directory_plan_id, directory_subscription_status, directory_subscription_external_id, platform_lunarpay_customer_id',
    )
    .eq('id', venueId)
    .maybeSingle();

  if (vErr || !venue) return null;

  let plan: VenuePlanRow['plan'] = null;
  if (venue.directory_plan_id) {
    const { data: p } = await supabaseAdmin
      .from('directory_plans')
      .select('id, name, price_monthly_cents, fortis_merchant_id')
      .eq('id', venue.directory_plan_id)
      .maybeSingle();
    if (p) plan = p as VenuePlanRow['plan'];
  }

  return {
    venue: venue as VenuePlanRow['venue'],
    plan,
  };
}

export async function createDirectoryPlatformCheckoutSession(venueId: string): Promise<{ url: string }> {
  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx?.plan) {
    throw new Error('No directory plan assigned');
  }
  const cents = ctx.plan.price_monthly_cents ?? 0;
  if (cents <= 0) {
    throw new Error('Plan has no monthly price — billing not required');
  }

  const secret = requirePlatformLunarPaySecretKey();
  const amountDollars = cents / 100;
  const checkoutData: Record<string, unknown> = {
    amount: amountDollars,
    description: `StoryVenue directory — ${ctx.plan.name} (monthly)`,
    customer_email: ctx.venue.email || undefined,
    customer_name: ctx.venue.name,
    success_url: `${APP_URL}/dashboard/directory-billing`,
    cancel_url: `${APP_URL}/dashboard/directory-billing`,
    metadata: {
      [STORYPAY_PLATFORM_DIRECTORY_META_KEY]: '1',
      venue_id: venueId,
      directory_plan_id: ctx.plan.id,
    },
  };

  const result = await createCheckoutSession(secret, checkoutData);
  const session = (result as { data?: { url?: string; id?: string }; url?: string }).data || result;
  const url = (session as { url?: string }).url;
  if (!url) {
    throw new Error('LunarPay did not return a checkout URL');
  }
  return { url };
}

function sessionMeta(session: Record<string, unknown>): Record<string, string> {
  const m = session.metadata || session.Metadata;
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      if (v !== undefined && v !== null) out[k] = String(v);
    }
    return out;
  }
  return {};
}

export async function verifyDirectoryPlatformCheckoutAndSubscribe(
  venueId: string,
  sessionId: string,
): Promise<{ subscriptionId: string | number }> {
  const secret = requirePlatformLunarPaySecretKey();
  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx?.plan) {
    throw new Error('No directory plan assigned');
  }
  const cents = ctx.plan.price_monthly_cents ?? 0;
  if (cents <= 0) {
    throw new Error('Plan has no monthly price');
  }

  if (
    ctx.venue.directory_subscription_external_id &&
    ctx.venue.directory_subscription_status === 'active'
  ) {
    return { subscriptionId: ctx.venue.directory_subscription_external_id };
  }

  const result = await getCheckoutSession(secret, sessionId);
  const session = (result as { data?: Record<string, unknown> }).data || (result as Record<string, unknown>);
  if (session.status !== 'completed') {
    throw new Error(`Checkout not completed (status: ${String(session.status)})`);
  }

  const meta = sessionMeta(session as Record<string, unknown>);
  if (
    meta[STORYPAY_PLATFORM_DIRECTORY_META_KEY] !== '1' ||
    meta.venue_id !== venueId ||
    meta.directory_plan_id !== ctx.plan.id
  ) {
    throw new Error('Checkout session does not match this venue or plan');
  }

  const customerId =
    session.customer_id || session.customerId || ctx.venue.platform_lunarpay_customer_id;
  const paymentMethodId =
    session.payment_method_id || session.paymentMethodId || session.payment_method;

  if (!customerId || !paymentMethodId) {
    throw new Error('Missing customer or payment method from checkout session');
  }

  const startOn = new Date().toISOString().slice(0, 10);
  const subPayload = {
    customerId: Number(customerId),
    paymentMethodId: Number(paymentMethodId),
    amount: cents,
    frequency: 'monthly',
    startOn,
    description: `StoryVenue directory — ${ctx.plan.name}`,
  };

  const subResult = await createSubscription(secret, subPayload as Record<string, unknown>);
  const sub = (subResult as { data?: { id?: string | number }; id?: string | number }).data || subResult;
  const subId = (sub as { id?: string | number }).id;
  if (subId === undefined || subId === null) {
    throw new Error('LunarPay did not return a subscription id');
  }

  const fortisId = getPlatformFortisMerchantId(ctx.plan.fortis_merchant_id);

  await supabaseAdmin
    .from('venues')
    .update({
      directory_subscription_status: 'active',
      directory_subscription_external_id: String(subId),
      platform_lunarpay_customer_id: String(customerId),
    })
    .eq('id', venueId);

  await supabaseAdmin.from('platform_billing_events').insert({
    venue_id: venueId,
    directory_plan_id: ctx.plan.id,
    amount_cents: cents,
    currency: 'usd',
    fortis_merchant_id: fortisId,
    external_event_id: `checkout:${sessionId}`,
    event_type: 'subscription_start',
    metadata: { session_id: sessionId, subscription_id: String(subId) },
  });

  return { subscriptionId: subId };
}

export async function insertPlatformBillingEventFromWebhook(params: {
  venueId: string;
  directoryPlanId: string | null;
  amountCents: number;
  eventType: string;
  externalEventId: string | null;
  fortisMerchantId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (params.externalEventId) {
    const { data: existing } = await supabaseAdmin
      .from('platform_billing_events')
      .select('id')
      .eq('external_event_id', params.externalEventId)
      .maybeSingle();
    if (existing) return;
  }

  await supabaseAdmin.from('platform_billing_events').insert({
    venue_id: params.venueId,
    directory_plan_id: params.directoryPlanId,
    amount_cents: params.amountCents,
    currency: 'usd',
    fortis_merchant_id: params.fortisMerchantId ?? null,
    external_event_id: params.externalEventId,
    event_type: params.eventType,
    metadata: params.metadata ?? {},
  });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function flattenMetadata(obj: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: unknown) => {
    const r = asRecord(node);
    if (!r) return;
    const m = r.metadata ?? r.meta;
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
        if (v !== undefined && v !== null) out[k] = String(v);
      }
    }
    for (const k of ['data', 'object', 'charge', 'transaction', 'payload']) {
      if (r[k] !== undefined) walk(r[k]);
    }
  };
  const root = asRecord(obj);
  if (root?.metadata && typeof root.metadata === 'object' && !Array.isArray(root.metadata)) {
    for (const [k, v] of Object.entries(root.metadata as Record<string, unknown>)) {
      if (v !== undefined && v !== null) out[k] = String(v);
    }
  }
  walk(obj);
  return out;
}

function pickAmountCents(obj: unknown): number {
  const r = asRecord(obj);
  if (!r) return 0;
  for (const key of ['amountCents', 'amount_cents', 'totalCents', 'total_cents'] as const) {
    const c = r[key];
    if (typeof c === 'number' && c > 0) return Math.round(c);
  }
  const a = r.amount;
  if (typeof a === 'number' && a > 0) {
    if (!Number.isInteger(a)) return Math.round(a * 100);
    if (a >= 1000) return Math.round(a);
    return Math.round(a * 100);
  }
  const nested = r.data ?? r.transaction ?? r.charge;
  if (nested) return pickAmountCents(nested);
  return 0;
}

function pickSubscriptionId(obj: unknown): string | null {
  const r = asRecord(obj);
  if (!r) return null;
  const direct = r.subscriptionId ?? r.subscription_id ?? r.subscriptionID;
  if (direct !== undefined && direct !== null) return String(direct);
  const sub = r.subscription;
  const subObj = asRecord(sub);
  if (subObj?.id !== undefined && subObj.id !== null) return String(subObj.id);
  const nested = r.data;
  if (nested) return pickSubscriptionId(nested);
  return null;
}

function pickExternalId(obj: unknown): string | null {
  const r = asRecord(obj);
  if (!r) return null;
  const id = r.id ?? r.transactionId ?? r.transaction_id ?? r.chargeId ?? r.charge_id;
  if (id !== undefined && id !== null) return String(id);
  return null;
}

/**
 * Handle LunarPay webhook payloads for StoryVenue platform (directory SaaS) revenue.
 * Returns true if handled (caller should still 200).
 */
export async function handleLunarPayWebhookForPlatformLedger(raw: Record<string, unknown>): Promise<boolean> {
  const meta = flattenMetadata(raw);
  const fortis = getPlatformFortisMerchantId(null);

  if (meta[STORYPAY_PLATFORM_DIRECTORY_META_KEY] === '1' && meta.venue_id) {
    const amount = pickAmountCents(raw);
    if (amount > 0) {
      await insertPlatformBillingEventFromWebhook({
        venueId: meta.venue_id,
        directoryPlanId: meta.directory_plan_id || null,
        amountCents: amount,
        eventType: String(raw.event || 'platform_charge'),
        externalEventId: pickExternalId(raw),
        fortisMerchantId: fortis,
        metadata: { source: 'webhook_metadata' },
      });
    }
    return true;
  }

  const subId = pickSubscriptionId(raw);
  if (subId) {
    const { data: v } = await supabaseAdmin
      .from('venues')
      .select('id, directory_plan_id')
      .eq('directory_subscription_external_id', subId)
      .maybeSingle();

    if (v) {
      const event = String(raw.event || '');
      const amount = pickAmountCents(raw);
      if (amount > 0) {
        await insertPlatformBillingEventFromWebhook({
          venueId: v.id as string,
          directoryPlanId: (v.directory_plan_id as string) || null,
          amountCents: amount,
          eventType: event || 'subscription_cycle',
          externalEventId: pickExternalId(raw),
          fortisMerchantId: fortis,
          metadata: { subscription_id: subId },
        });
      }
      if (/payment\.failed|charge\.failed|subscription\.(past_due|canceled|cancelled)/i.test(event)) {
        await supabaseAdmin
          .from('venues')
          .update({
            directory_subscription_status: /canceled|cancelled/i.test(event) ? 'canceled' : 'past_due',
          })
          .eq('id', v.id as string);
      }
      return true;
    }
  }

  return false;
}
