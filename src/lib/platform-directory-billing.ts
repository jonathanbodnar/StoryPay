import { createCheckoutSession, getCheckoutSession, listSubscriptions, getCustomer } from '@/lib/lunarpay';
import { supabaseAdmin } from '@/lib/supabase';
import { getPlatformFortisMerchantId } from '@/lib/platform-billing';
import { notifyVenueSubscriptionCharged, notifyVenueCardDeclined } from '@/lib/saas-billing-notifications';

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
 *
 * NOTE on shared MID:
 * StoryPay and StoryVenue are the same legal entity (Myurbanspot LLC), so
 * STORYPAY_HQ_LUNARPAY_SK currently points at the same Fortis merchant
 * StoryVenue uses for proposals/invoices. The API doesn't care, but bear
 * in mind:
 *   1. SaaS revenue and proposal income land in the same Fortis deposit;
 *      reconciliation has to use checkout-session metadata or descriptions.
 *   2. Both flows share one MCC and one chargeback ratio.
 *   3. The card-statement descriptor reads the same for both. SaaS subs
 *      will see "STORYVENUE" on their statement.
 * If/when SaaS volume warrants its own MID, register a fresh "StoryPay HQ"
 * merchant via /api/admin/storypay-hq/onboard and swap the env var to its
 * keys — the rest of the code already works with a separate merchant.
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
    directory_trial_started_at: string | null;
    directory_trial_ends_at: string | null;
    directory_trial_plan_id: string | null;
    directory_trial_consumed: boolean | null;
    directory_trial_is_forever: boolean | null;
    directory_addon_verified: boolean | null;
    directory_addon_sponsored: boolean | null;
    directory_addon_concierge: boolean | null;
  };
  plan: {
    id: string;
    name: string;
    price_monthly_cents: number | null;
    fortis_merchant_id: string | null;
  } | null;
};

export async function loadVenueDirectoryPlanContext(venueId: string): Promise<VenuePlanRow | null> {
  // Columns that always exist. The add-on columns (migrations 092/096) may not
  // be applied yet on some environments — if the full SELECT errors because of
  // them, we retry without and default the add-on flags to false. Without this
  // fallback a missing add-on column would make this loader return null, which
  // silently breaks BOTH the add-on toggle AND plan changes (incl. Switch to
  // Free) for the venue.
  const baseColumns = `id, name, email,
       directory_plan_id,
       directory_subscription_status,
       directory_subscription_external_id,
       platform_lunarpay_customer_id,
       directory_trial_started_at,
       directory_trial_ends_at,
       directory_trial_plan_id,
       directory_trial_consumed,
       directory_trial_is_forever`;

  let venue: Record<string, unknown> | null = null;
  const full = await supabaseAdmin
    .from('venues')
    .select(`${baseColumns}, directory_addon_verified, directory_addon_sponsored, directory_addon_concierge`)
    .eq('id', venueId)
    .maybeSingle();

  if (full.error) {
    const slim = await supabaseAdmin
      .from('venues')
      .select(baseColumns)
      .eq('id', venueId)
      .maybeSingle();
    if (slim.error || !slim.data) return null;
    venue = {
      ...(slim.data as Record<string, unknown>),
      directory_addon_verified: false,
      directory_addon_sponsored: false,
      directory_addon_concierge: false,
    };
  } else {
    venue = (full.data ?? null) as Record<string, unknown> | null;
  }

  if (!venue) return null;

  let plan: VenuePlanRow['plan'] = null;
  if (venue.directory_plan_id) {
    const { data: p } = await supabaseAdmin
      .from('directory_plans')
      .select('id, name, price_monthly_cents, fortis_merchant_id')
      .eq('id', venue.directory_plan_id as string)
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
    mode: 'subscription',
    recurring: { frequency: 'monthly' },
    customer_email: ctx.venue.email || undefined,
    customer_name: ctx.venue.name,
    payment_methods: ['cc'],
    metadata: {
      storypay_venue_id: venueId,
      storypay_plan_id: ctx.plan.id,
      flow: 'directory_platform',
    },
    success_url: `${APP_URL}/dashboard/directory-billing`,
    cancel_url: `${APP_URL}/dashboard/directory-billing`,
  };

  const result = await createCheckoutSession(secret, checkoutData);
  const session = (result as { data?: { url?: string; id?: string }; url?: string }).data || result;
  const url = (session as { url?: string }).url;
  if (!url) {
    throw new Error('LunarPay did not return a checkout URL');
  }
  return { url };
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

  // LP subscription-mode sessions include the subscription ID directly.
  const subId =
    (session.subscription_id as string | number | null) ??
    (session.subscriptionId as string | number | null) ??
    ((session.subscription as Record<string, unknown> | null)?.id as string | number | null | undefined) ??
    null;

  const customerId =
    session.customer_id || session.customerId || ctx.venue.platform_lunarpay_customer_id;

  if (subId === null || subId === undefined) {
    throw new Error('LunarPay session did not return a subscription_id — expected mode:subscription');
  }

  const fortisId = getPlatformFortisMerchantId(ctx.plan.fortis_merchant_id);

  await supabaseAdmin
    .from('venues')
    .update({
      directory_subscription_status: 'active',
      directory_subscription_external_id: String(subId),
      platform_lunarpay_customer_id: customerId ? String(customerId) : undefined,
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
    metadata: { session_id: sessionId, subscription_id: String(subId), mode: 'subscription' },
  });

  return { subscriptionId: subId };
}

export type LunarPaySubscriptionMismatch = {
  lpSubscriptionId: string;
  lpCustomerId: string | null;
  lpStatus: string;
  lpAmountCents: number;
  lpFrequency: string;
  matchedBy: 'already_linked' | 'customer_id' | 'email' | 'unmatched';
  venue: { id: string; name: string; email: string | null } | null;
  currentStatus: string | null;
  currentExternalId: string | null;
  inSync: boolean;
};

/**
 * Cross-checks every subscription on file with StoryPay HQ's LunarPay
 * merchant against `venues.directory_subscription_status` /
 * `directory_subscription_external_id`.
 *
 * Why this can drift: the happy path writes those two columns from
 * verifyDirectoryPlatformCheckoutAndSubscribe() right after checkout, and
 * every renewal/failure webhook after that keys off
 * directory_subscription_external_id (see
 * handleLunarPayWebhookForPlatformLedger below). If that first write never
 * lands — the browser closed before the success redirect finished, a
 * network blip, a subscription created by hand in the LunarPay dashboard —
 * the venue is stuck on its old status (often 'trialing' or 'none') forever,
 * even though LunarPay is happily charging the card every cycle. This audit
 * finds those out-of-sync venues so they can be fixed with a single click
 * instead of a one-off SQL patch every time it happens.
 *
 * Read-only — call applyLunarPaySubscriptionFix() to actually write a fix.
 */
export async function auditPlatformSubscriptionsAgainstLunarPay(): Promise<{
  mismatches: LunarPaySubscriptionMismatch[];
  inSyncCount: number;
  error?: string;
}> {
  const secret = getPlatformLunarPaySecretKey();
  if (!secret) {
    return { mismatches: [], inSyncCount: 0, error: 'STORYPAY_HQ_LUNARPAY_SK is not configured.' };
  }

  let subList: Record<string, unknown>[];
  try {
    const result = await listSubscriptions(secret);
    subList = (Array.isArray(result) ? result : (result as { data?: unknown[] }).data ?? []) as Record<string, unknown>[];
  } catch (e) {
    return { mismatches: [], inSyncCount: 0, error: e instanceof Error ? e.message : 'LunarPay request failed' };
  }

  const { data: venuesRaw } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, directory_subscription_status, directory_subscription_external_id, platform_lunarpay_customer_id');
  const venues = (venuesRaw ?? []) as Array<{
    id: string; name: string; email: string | null;
    directory_subscription_status: string | null; directory_subscription_external_id: string | null;
    platform_lunarpay_customer_id: string | null;
  }>;
  const byCustomerId = new Map(venues.filter((v) => v.platform_lunarpay_customer_id).map((v) => [String(v.platform_lunarpay_customer_id), v]));
  const byEmail = new Map(venues.filter((v) => v.email).map((v) => [v.email!.toLowerCase(), v]));
  const byExternalId = new Map(venues.filter((v) => v.directory_subscription_external_id).map((v) => [String(v.directory_subscription_external_id), v]));

  // A subscription is only truly "paying" if LunarPay has recorded at least
  // one successful transaction on it (successTrxns > 0 or lastPaymentOn set).
  // LP status='active' alone is not sufficient — it just means the subscription
  // record exists and isn't cancelled; it does NOT mean the card has been
  // charged. A brand-new subscription within its 14-day trial window will show
  // status='active' with successTrxns=0 and no lastPaymentOn — those are
  // correctly 'trialing' locally and must NOT be bumped to 'active'.
  function hasBeenCharged(sub: Record<string, unknown>): boolean {
    const trxns = typeof sub.successTrxns === 'number' ? sub.successTrxns : 0;
    const lastPmt = sub.lastPaymentOn ?? sub.lastPaymentDate ?? null;
    return trxns > 0 || (lastPmt !== null && lastPmt !== undefined);
  }

  const mismatches: LunarPaySubscriptionMismatch[] = [];
  let inSyncCount = 0;

  for (const sub of subList) {
    const lpId = String(sub.id ?? '');
    if (!lpId) continue;
    const lpStatus = String(sub.status ?? 'unknown').toLowerCase();
    const lpCustomerId = sub.customerId != null ? String(sub.customerId) : null;

    // Already correctly linked — fast path, no LP customer lookup needed.
    // "In sync" must be strict: a venue whose LP subscription is already
    // `active` (i.e. actually being charged) but is still sitting on a local
    // `trialing`/`none` status is NOT in sync — that's precisely the drift
    // this audit exists to catch. Local `active` always satisfies any LP
    // paying status; otherwise the local status must match the LP status
    // exactly (e.g. both `trialing`, or both `past_due`).
    const linkedVenue = byExternalId.get(lpId);
    if (linkedVenue) {
      const localStatus = linkedVenue.directory_subscription_status;
      const isSynced = localStatus === 'active' || localStatus === lpStatus;
      if (isSynced) { inSyncCount += 1; continue; }
    }

    // Only surface as a mismatch if the card has actually been charged —
    // an LP 'active' subscription with 0 successful transactions is still
    // in its trial window and the local 'trialing' status is correct.
    if (!hasBeenCharged(sub)) continue;

    let venue = linkedVenue ?? (lpCustomerId ? byCustomerId.get(lpCustomerId) : undefined) ?? null;
    let matchedBy: LunarPaySubscriptionMismatch['matchedBy'] = linkedVenue
      ? 'already_linked'
      : venue
        ? 'customer_id'
        : 'unmatched';

    if (!venue && lpCustomerId) {
      try {
        const custResult = await getCustomer(secret, lpCustomerId);
        const cust = ((custResult as { data?: Record<string, unknown> }).data ?? custResult) as Record<string, unknown>;
        const email = typeof cust.email === 'string' ? cust.email.toLowerCase() : null;
        if (email && byEmail.has(email)) {
          venue = byEmail.get(email) ?? null;
          matchedBy = 'email';
        }
      } catch {
        // best-effort — leave unmatched, still surfaced below for manual review
      }
    }

    mismatches.push({
      lpSubscriptionId: lpId,
      lpCustomerId,
      lpStatus,
      lpAmountCents: typeof sub.amount === 'number' ? Math.round(sub.amount) : 0,
      lpFrequency: String(sub.frequency ?? 'monthly'),
      matchedBy: venue ? matchedBy : 'unmatched',
      venue: venue ? { id: venue.id, name: venue.name, email: venue.email } : null,
      currentStatus: venue?.directory_subscription_status ?? null,
      currentExternalId: venue?.directory_subscription_external_id ?? null,
      inSync: false,
    });
  }

  return { mismatches, inSyncCount };
}

/**
 * Applies the fix a super-admin confirmed from the audit above: links the
 * LunarPay subscription to the venue and flips it to 'active'. Also logs a
 * platform_billing_events row so the reconciliation is auditable.
 */
export async function applyLunarPaySubscriptionFix(params: {
  venueId: string;
  lpSubscriptionId: string;
  lpCustomerId: string | null;
  lpAmountCents: number;
}): Promise<void> {
  await supabaseAdmin
    .from('venues')
    .update({
      directory_subscription_status: 'active',
      directory_subscription_external_id: params.lpSubscriptionId,
      platform_lunarpay_customer_id: params.lpCustomerId ?? undefined,
      directory_downgrade_at: null,
    })
    .eq('id', params.venueId);

  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select('directory_plan_id')
    .eq('id', params.venueId)
    .maybeSingle();

  await supabaseAdmin.from('platform_billing_events').insert({
    venue_id: params.venueId,
    directory_plan_id: (venueRow as { directory_plan_id?: string } | null)?.directory_plan_id ?? null,
    amount_cents: 0, // reconciliation marker only — real charge amounts already exist as separate events (or will on the next cycle)
    currency: 'usd',
    external_event_id: `resync:${params.lpSubscriptionId}:${Date.now()}`,
    event_type: 'admin_resync',
    metadata: { source: 'lunarpay_audit_fix', lp_subscription_id: params.lpSubscriptionId, lp_amount_cents: params.lpAmountCents },
  });
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
      .select('id, directory_plan_id, directory_subscription_status')
      .eq('directory_subscription_external_id', subId)
      .maybeSingle();

    if (v) {
      const event = String(raw.event || '');
      const amount = pickAmountCents(raw);
      const prevStatus = String((v as Record<string, unknown>).directory_subscription_status ?? '').toLowerCase();
      const isFailure = /payment\.failed|charge\.failed|subscription\.past_due/i.test(event);
      const isCancel = /subscription\.(canceled|cancelled)/i.test(event);
      // A successful money movement (a renewal/trial-conversion charge) — either
      // an explicit success event, or any positive-amount event that isn't a
      // failure/cancel.
      const isSuccessCharge =
        !isFailure && !isCancel &&
        (amount > 0 || /payment\.(succeeded|success)|charge\.(succeeded|success)|subscription\.(charged|renewed|payment_succeeded)/i.test(event));

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

      if (isFailure || isCancel) {
        // Mark status only. We NEVER auto-downgrade to Free — Free is reachable
        // only by the owner's explicit choice. A declined renewal sits in
        // 'past_due' (automations pause via entitlement) until they fix the card
        // or choose to downgrade; a LunarPay-side cancel sits in 'canceled'.
        await supabaseAdmin
          .from('venues')
          .update({ directory_subscription_status: isCancel ? 'canceled' : 'past_due' })
          .eq('id', v.id as string);
        // Fire the "card declined" nudge once, on first transition to past_due.
        if (isFailure && prevStatus !== 'past_due') {
          void notifyVenueCardDeclined(v.id as string).catch(() => {});
        }
      } else if (isSuccessCharge) {
        // First successful charge flips a trial (or a recovered past_due) to a
        // paying subscription. Idempotent — safe to re-apply on every renewal.
        await supabaseAdmin
          .from('venues')
          .update({ directory_subscription_status: 'active', directory_downgrade_at: null })
          .eq('id', v.id as string);
        // Trial → paid conversion: fire the receipt/welcome comm once.
        if (prevStatus === 'trialing' || prevStatus === 'past_due') {
          void notifyVenueSubscriptionCharged(v.id as string, amount).catch(() => {});
        }
      }
      return true;
    }
  }

  return false;
}
