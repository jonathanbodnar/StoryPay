import { supabaseAdmin } from './supabase';
import {
  cancelSubscription,
  createCheckoutSession,
  getCheckoutSession,
  getSubscription,
  listPaymentMethods,
  updateSubscription,
} from './lunarpay';
import {
  getPlatformFortisMerchantId,
} from './platform-billing';
import {
  getPlatformLunarPaySecretKey,
  loadVenueDirectoryPlanContext,
  requirePlatformLunarPaySecretKey,
  STORYPAY_PLATFORM_DIRECTORY_META_KEY,
  verifyDirectoryPlatformCheckoutAndSubscribe,
  type VenuePlanRow,
} from './platform-directory-billing';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';

export type DirectoryPlanCatalogEntry = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_monthly_cents: number | null;
  is_default: boolean;
  sort_order: number;
  feature_flags: Record<string, unknown>;
};

export type VenueBillingPaymentMethod = {
  id: string;
  last4: string | null;
  brand: string | null;
  name_holder: string | null;
  is_default: boolean;
  exp_month: string | null;
  exp_year: string | null;
} | null;

export type VenueBillingSubscription = {
  id: string;
  status: string;
  amount_cents: number;
  frequency: string;
  next_payment_on: string | null;
  started_on: string | null;
} | null;

export type VenueBillingHistoryEntry = {
  id: string;
  event_type: string;
  amount_cents: number;
  currency: string;
  occurred_at: string;
  plan_id: string | null;
  plan_name: string | null;
  external_event_id: string | null;
  status: 'paid' | 'refunded' | 'failed' | 'pending';
};

export type VenueBillingSummary = {
  venue: {
    id: string;
    name: string;
    email: string | null;
  };
  current_plan: DirectoryPlanCatalogEntry | null;
  subscription: VenueBillingSubscription;
  subscription_status: string;
  payment_method: VenueBillingPaymentMethod;
  plans: DirectoryPlanCatalogEntry[];
  history: VenueBillingHistoryEntry[];
  billing_configured: boolean;
};

function mapPlanRow(row: Record<string, unknown>): DirectoryPlanCatalogEntry {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    description: (row.description as string | null) ?? null,
    price_monthly_cents:
      typeof row.price_monthly_cents === 'number' ? (row.price_monthly_cents as number) : null,
    is_default: Boolean(row.is_default),
    sort_order: typeof row.sort_order === 'number' ? (row.sort_order as number) : 0,
    feature_flags:
      (row.feature_flags && typeof row.feature_flags === 'object' && !Array.isArray(row.feature_flags)
        ? (row.feature_flags as Record<string, unknown>)
        : {}) ?? {},
  };
}

export async function listDirectoryPlanCatalog(): Promise<DirectoryPlanCatalogEntry[]> {
  const { data } = await supabaseAdmin
    .from('directory_plans')
    .select('id, name, slug, description, price_monthly_cents, is_default, sort_order, feature_flags')
    .order('price_monthly_cents', { ascending: true, nullsFirst: true })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  return (data ?? []).map(mapPlanRow);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

async function fetchLiveSubscription(
  secret: string,
  id: string | null,
): Promise<VenueBillingSubscription> {
  if (!id) return null;
  try {
    const res = (await getSubscription(secret, id)) as Record<string, unknown>;
    const raw = (asRecord(res.data) ?? res) as Record<string, unknown>;
    const amount = Number(raw.amount ?? 0) || 0;
    return {
      id: String(raw.id ?? id),
      status: String(raw.status ?? 'unknown'),
      amount_cents: amount,
      frequency: String(raw.frequency ?? 'monthly'),
      next_payment_on:
        (raw.nextPaymentOn as string | null) || (raw.next_payment_on as string | null) || null,
      started_on: (raw.startOn as string | null) || (raw.start_on as string | null) || null,
    };
  } catch {
    return null;
  }
}

async function fetchDefaultPaymentMethod(
  secret: string,
  customerId: string | null,
): Promise<VenueBillingPaymentMethod> {
  if (!customerId) return null;
  try {
    const res = (await listPaymentMethods(secret, Number(customerId))) as Record<string, unknown>;
    const list = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
    if (list.length === 0) return null;
    const def = list.find((p) => p.isDefault === true || p.is_default === true) || list[0];
    return {
      id: String(def.id ?? ''),
      last4: (def.lastDigits as string | null) || (def.last_digits as string | null) || null,
      brand: (def.sourceType as string | null) || (def.brand as string | null) || null,
      name_holder: (def.nameHolder as string | null) || (def.name_holder as string | null) || null,
      is_default: Boolean(def.isDefault ?? def.is_default ?? false),
      exp_month: (def.expMonth as string | null) || (def.exp_month as string | null) || null,
      exp_year: (def.expYear as string | null) || (def.exp_year as string | null) || null,
    };
  } catch {
    return null;
  }
}

async function loadBillingHistory(venueId: string): Promise<VenueBillingHistoryEntry[]> {
  const { data: rows } = await supabaseAdmin
    .from('platform_billing_events')
    .select('id, event_type, amount_cents, currency, occurred_at, directory_plan_id, external_event_id, metadata')
    .eq('venue_id', venueId)
    .order('occurred_at', { ascending: false })
    .limit(50);
  if (!rows || rows.length === 0) return [];

  const planIds = Array.from(new Set(rows.map((r) => r.directory_plan_id).filter(Boolean))) as string[];
  const { data: planRows } =
    planIds.length > 0
      ? await supabaseAdmin
          .from('directory_plans')
          .select('id, name')
          .in('id', planIds)
      : { data: [] as { id: string; name: string }[] };
  const planNameById = new Map((planRows || []).map((p) => [p.id as string, p.name as string]));

  return rows.map((r) => {
    const event = String(r.event_type);
    let status: VenueBillingHistoryEntry['status'] = 'paid';
    if (/refund/i.test(event)) status = 'refunded';
    else if (/fail|past_due/i.test(event)) status = 'failed';
    else if (/pending|scheduled/i.test(event)) status = 'pending';
    return {
      id: String(r.id),
      event_type: event,
      amount_cents: typeof r.amount_cents === 'number' ? (r.amount_cents as number) : 0,
      currency: String(r.currency || 'usd'),
      occurred_at: String(r.occurred_at),
      plan_id: (r.directory_plan_id as string | null) ?? null,
      plan_name:
        r.directory_plan_id && planNameById.has(r.directory_plan_id as string)
          ? planNameById.get(r.directory_plan_id as string) || null
          : null,
      external_event_id: (r.external_event_id as string | null) ?? null,
      status,
    };
  });
}

export async function loadVenueBillingSummary(venueId: string): Promise<VenueBillingSummary> {
  const ctx = await loadVenueDirectoryPlanContext(venueId);
  const plans = await listDirectoryPlanCatalog();
  const history = await loadBillingHistory(venueId);
  const secret = getPlatformLunarPaySecretKey();

  let subscription: VenueBillingSubscription = null;
  let paymentMethod: VenueBillingPaymentMethod = null;
  if (secret) {
    subscription = await fetchLiveSubscription(
      secret,
      ctx?.venue.directory_subscription_external_id || null,
    );
    paymentMethod = await fetchDefaultPaymentMethod(
      secret,
      ctx?.venue.platform_lunarpay_customer_id || null,
    );
  }

  const current = ctx?.plan
    ? plans.find((p) => p.id === ctx.plan!.id) || mapPlanRow(ctx.plan as unknown as Record<string, unknown>)
    : null;

  return {
    venue: {
      id: ctx?.venue.id || venueId,
      name: ctx?.venue.name || '',
      email: ctx?.venue.email ?? null,
    },
    current_plan: current,
    subscription,
    subscription_status: ctx?.venue.directory_subscription_status || 'none',
    payment_method: paymentMethod,
    plans,
    history,
    billing_configured: Boolean(secret),
  };
}

// ── Plan change ─────────────────────────────────────────────────────────────

export type ChangePlanResult =
  | { kind: 'switched'; plan_id: string }
  | { kind: 'checkout_required'; url: string; plan_id: string };

async function recordBillingEvent(
  venueId: string,
  planId: string | null,
  amountCents: number,
  eventType: string,
  externalEventId: string,
  metadata: Record<string, unknown> = {},
) {
  await supabaseAdmin.from('platform_billing_events').insert({
    venue_id: venueId,
    directory_plan_id: planId,
    amount_cents: amountCents,
    currency: 'usd',
    fortis_merchant_id: getPlatformFortisMerchantId(null),
    external_event_id: externalEventId,
    event_type: eventType,
    metadata,
  });
}

export async function changeVenuePlan(
  venueId: string,
  targetPlanId: string,
): Promise<ChangePlanResult> {
  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx) throw new Error('Venue not found');

  const { data: targetRow } = await supabaseAdmin
    .from('directory_plans')
    .select('id, name, price_monthly_cents, fortis_merchant_id')
    .eq('id', targetPlanId)
    .maybeSingle();
  if (!targetRow) throw new Error('Plan not found');

  const target = targetRow as VenuePlanRow['plan'];
  if (!target) throw new Error('Plan not found');

  if (ctx.venue.directory_plan_id === target.id) {
    return { kind: 'switched', plan_id: target.id };
  }

  const newCents = target.price_monthly_cents ?? 0;
  const currentCents = ctx.plan?.price_monthly_cents ?? 0;
  const subId = ctx.venue.directory_subscription_external_id;
  const status = ctx.venue.directory_subscription_status;
  const hasActiveSub = Boolean(subId && (status === 'active' || status === 'trialing' || status === 'past_due'));

  // Moving to a free plan: cancel any existing sub then swap.
  if (newCents <= 0) {
    if (hasActiveSub && subId) {
      const secret = getPlatformLunarPaySecretKey();
      if (secret) {
        try {
          await cancelSubscription(secret, subId);
        } catch {
          // Surface a clearer error if LunarPay rejects.
          throw new Error('Could not cancel current subscription. Try again or contact support.');
        }
      }
      await recordBillingEvent(
        venueId,
        ctx.plan?.id || null,
        0,
        'subscription_cancel',
        `plan_change:${Date.now()}:${venueId}`,
        { reason: 'switched_to_free_plan', previous_subscription_id: subId },
      );
    }
    await supabaseAdmin
      .from('venues')
      .update({
        directory_plan_id: target.id,
        directory_subscription_status: 'none',
        directory_subscription_external_id: null,
      })
      .eq('id', venueId);
    await recordBillingEvent(
      venueId,
      target.id,
      0,
      'plan_change',
      `plan_change:${target.id}:${venueId}:${Date.now()}`,
      { previous_plan_id: ctx.plan?.id || null, new_plan_id: target.id },
    );
    return { kind: 'switched', plan_id: target.id };
  }

  // Both plans priced and we have an active subscription — PATCH the amount.
  if (hasActiveSub && subId && currentCents > 0) {
    const secret = requirePlatformLunarPaySecretKey();
    try {
      await updateSubscription(secret, subId, { amount: newCents });
    } catch (e) {
      throw new Error(
        `LunarPay rejected the plan change: ${e instanceof Error ? e.message : 'unknown error'}`,
      );
    }
    await supabaseAdmin
      .from('venues')
      .update({ directory_plan_id: target.id, directory_subscription_status: 'active' })
      .eq('id', venueId);
    await recordBillingEvent(
      venueId,
      target.id,
      0,
      'plan_change',
      `plan_change:${target.id}:${venueId}:${Date.now()}`,
      {
        previous_plan_id: ctx.plan?.id || null,
        new_plan_id: target.id,
        previous_amount_cents: currentCents,
        new_amount_cents: newCents,
        subscription_id: subId,
      },
    );
    return { kind: 'switched', plan_id: target.id };
  }

  // No active subscription — need a checkout.
  //
  // IMPORTANT: create the LunarPay checkout session FIRST. Only mark the venue
  // as `pending` once we have a valid URL to send them to. This way a config
  // failure (bad API key, network blip, etc.) leaves the DB clean instead of
  // stranding the venue in a pending-but-no-checkout state.
  const secret = requirePlatformLunarPaySecretKey();
  const amountDollars = newCents / 100;
  const checkoutData: Record<string, unknown> = {
    amount: amountDollars,
    description: `StoryVenue directory — ${target.name} (monthly)`,
    customer_email: ctx.venue.email || undefined,
    customer_name: ctx.venue.name,
    success_url: `${APP_URL}/dashboard/directory-billing`,
    cancel_url: `${APP_URL}/dashboard/directory-billing`,
    save_payment_method: true,
    metadata: {
      [STORYPAY_PLATFORM_DIRECTORY_META_KEY]: '1',
      venue_id: venueId,
      directory_plan_id: target.id,
    },
  };
  if (ctx.venue.platform_lunarpay_customer_id) {
    checkoutData.customer_id = ctx.venue.platform_lunarpay_customer_id;
  }
  const result = await createCheckoutSession(secret, checkoutData);
  const session = (result as { data?: { url?: string }; url?: string }).data || result;
  const url = (session as { url?: string }).url;
  if (!url) throw new Error('LunarPay did not return a checkout URL');

  // Checkout URL secured — now safe to pre-assign the plan + pending status.
  await supabaseAdmin
    .from('venues')
    .update({ directory_plan_id: target.id, directory_subscription_status: 'pending' })
    .eq('id', venueId);

  return { kind: 'checkout_required', url, plan_id: target.id };
}

/**
 * Re-create a checkout session for a venue that's stuck in `pending` status
 * (e.g. closed the LunarPay tab, bad network, server hiccup mid-flow). Uses
 * the venue's currently-assigned directory_plan_id rather than asking the
 * caller for one — that's the plan we previously marked as pending.
 */
export async function resumePendingCheckout(venueId: string): Promise<{ url: string }> {
  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx) throw new Error('Venue not found');
  if (!ctx.plan) throw new Error('No directory plan assigned to resume.');
  const cents = ctx.plan.price_monthly_cents ?? 0;
  if (cents <= 0) {
    throw new Error('Free plans do not require checkout.');
  }
  const secret = requirePlatformLunarPaySecretKey();
  const checkoutData: Record<string, unknown> = {
    amount: cents / 100,
    description: `StoryVenue directory — ${ctx.plan.name} (monthly)`,
    customer_email: ctx.venue.email || undefined,
    customer_name: ctx.venue.name,
    success_url: `${APP_URL}/dashboard/directory-billing`,
    cancel_url: `${APP_URL}/dashboard/directory-billing`,
    save_payment_method: true,
    metadata: {
      [STORYPAY_PLATFORM_DIRECTORY_META_KEY]: '1',
      venue_id: venueId,
      directory_plan_id: ctx.plan.id,
    },
  };
  if (ctx.venue.platform_lunarpay_customer_id) {
    checkoutData.customer_id = ctx.venue.platform_lunarpay_customer_id;
  }
  const result = await createCheckoutSession(secret, checkoutData);
  const session = (result as { data?: { url?: string }; url?: string }).data || result;
  const url = (session as { url?: string }).url;
  if (!url) throw new Error('LunarPay did not return a checkout URL');
  return { url };
}

/**
 * Abort a pending upgrade — clears the venue's pending status and unassigns
 * the in-flight plan so they can pick a different one (or stay free).
 */
export async function cancelPendingUpgrade(venueId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('directory_subscription_status')
    .eq('id', venueId)
    .maybeSingle();
  const status = (data?.directory_subscription_status as string | null) || 'none';
  if (status !== 'pending') return; // no-op if not pending

  await supabaseAdmin
    .from('venues')
    .update({
      directory_plan_id: null,
      directory_subscription_status: 'none',
    })
    .eq('id', venueId);
}

// ── Cancel subscription ────────────────────────────────────────────────────

export async function cancelVenueSubscription(venueId: string): Promise<void> {
  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx) throw new Error('Venue not found');

  const subId = ctx.venue.directory_subscription_external_id;
  if (subId) {
    const secret = getPlatformLunarPaySecretKey();
    if (secret) {
      try {
        await cancelSubscription(secret, subId);
      } catch (e) {
        throw new Error(
          `Could not cancel subscription with LunarPay: ${e instanceof Error ? e.message : 'unknown error'}`,
        );
      }
    }
  }

  await supabaseAdmin
    .from('venues')
    .update({
      directory_subscription_status: 'canceled',
      directory_subscription_external_id: null,
    })
    .eq('id', venueId);

  await recordBillingEvent(
    venueId,
    ctx.plan?.id || null,
    0,
    'subscription_cancel',
    `cancel:${venueId}:${Date.now()}`,
    { subscription_id: subId || null, reason: 'user_cancelled' },
  );
}

// ── Update payment method ──────────────────────────────────────────────────

/**
 * Kick off a LunarPay checkout session dedicated to updating the saved card.
 *
 * Because the LunarPay subscription PATCH endpoint does not support swapping
 * the paymentMethodId, this flow charges the current plan price now on a new
 * card (via save_payment_method=true). After the customer returns, the
 * verify step replaces the active subscription with a new one bound to the
 * fresh paymentMethodId.
 */
export async function startUpdatePaymentMethodCheckout(
  venueId: string,
): Promise<{ url: string }> {
  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx) throw new Error('Venue not found');
  if (!ctx.plan) throw new Error('No directory plan assigned');
  const cents = ctx.plan.price_monthly_cents ?? 0;
  if (cents <= 0) {
    throw new Error('Free plans do not require a payment method on file.');
  }
  const secret = requirePlatformLunarPaySecretKey();
  const checkoutData: Record<string, unknown> = {
    amount: cents / 100,
    description: `StoryVenue directory — ${ctx.plan.name} (update card)`,
    customer_email: ctx.venue.email || undefined,
    customer_name: ctx.venue.name,
    success_url: `${APP_URL}/dashboard/directory-billing?payment_update=1`,
    cancel_url: `${APP_URL}/dashboard/directory-billing`,
    save_payment_method: true,
    metadata: {
      [STORYPAY_PLATFORM_DIRECTORY_META_KEY]: '1',
      venue_id: venueId,
      directory_plan_id: ctx.plan.id,
      action: 'update_payment_method',
    },
  };
  if (ctx.venue.platform_lunarpay_customer_id) {
    checkoutData.customer_id = ctx.venue.platform_lunarpay_customer_id;
  }
  const result = await createCheckoutSession(secret, checkoutData);
  const session = (result as { data?: { url?: string }; url?: string }).data || result;
  const url = (session as { url?: string }).url;
  if (!url) throw new Error('LunarPay did not return a checkout URL');
  return { url };
}

/**
 * Finish the update-payment flow: cancel the old subscription and create a new
 * one bound to the freshly saved payment method from the checkout session.
 */
export async function verifyUpdatePaymentMethod(
  venueId: string,
  sessionId: string,
): Promise<void> {
  const secret = requirePlatformLunarPaySecretKey();
  const ctx = await loadVenueDirectoryPlanContext(venueId);
  if (!ctx?.plan) throw new Error('No directory plan assigned');

  const result = (await getCheckoutSession(secret, sessionId)) as Record<string, unknown>;
  const session = (result.data as Record<string, unknown>) || result;
  if (session.status !== 'completed') {
    throw new Error(`Checkout not completed (status: ${String(session.status)})`);
  }

  const customerId =
    (session.customer_id as string | number | null) ||
    (session.customerId as string | number | null) ||
    ctx.venue.platform_lunarpay_customer_id;
  const paymentMethodId =
    (session.payment_method_id as string | number | null) ||
    (session.paymentMethodId as string | number | null) ||
    (session.payment_method as string | number | null);
  if (!customerId || !paymentMethodId) {
    throw new Error('Missing customer or payment method from checkout session');
  }

  const oldSubId = ctx.venue.directory_subscription_external_id;
  if (oldSubId) {
    try {
      await cancelSubscription(secret, oldSubId);
    } catch {
      // If it's already cancelled we can still proceed.
    }
  }

  // Re-use the subscribe helper via a fresh verify call - easier to just
  // import the existing verify helper isn't feasible here because it reads
  // metadata.action='update_payment_method' and would re-run swap logic.
  // Create subscription directly inline.
  const { createSubscription } = await import('./lunarpay');
  const cents = ctx.plan.price_monthly_cents ?? 0;
  const startOn = new Date().toISOString().slice(0, 10);
  const subResult = (await createSubscription(secret, {
    customerId: Number(customerId),
    paymentMethodId: Number(paymentMethodId),
    amount: cents,
    frequency: 'monthly',
    startOn,
    description: `StoryVenue directory — ${ctx.plan.name}`,
  })) as Record<string, unknown>;
  const sub = (subResult.data as Record<string, unknown>) || subResult;
  const newSubId = (sub.id as string | number | undefined) ?? null;
  if (newSubId === null) throw new Error('LunarPay did not return a subscription id');

  await supabaseAdmin
    .from('venues')
    .update({
      directory_subscription_status: 'active',
      directory_subscription_external_id: String(newSubId),
      platform_lunarpay_customer_id: String(customerId),
    })
    .eq('id', venueId);

  await recordBillingEvent(
    venueId,
    ctx.plan.id,
    cents,
    'payment_method_updated',
    `pm_update:${sessionId}`,
    { session_id: sessionId, old_subscription_id: oldSubId, new_subscription_id: String(newSubId) },
  );
}

// Re-export the standard checkout verify so the page can still use it
// via a single client call.
export { verifyDirectoryPlatformCheckoutAndSubscribe };
