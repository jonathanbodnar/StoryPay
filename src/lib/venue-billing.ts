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
  verifyDirectoryPlatformCheckoutAndSubscribe,
  type VenuePlanRow,
} from './platform-directory-billing';
import {
  computeMonthlyTotalCents,
  resolveEffectiveAddons,
  VERIFIED_PRICE_CENTS,
  SPONSORED_PRICE_CENTS,
  CONCIERGE_PRICE_CENTS,
  DEFAULT_ADDON_PRICES,
  type AddonPrices,
  type ChargeBreakdown,
  type EffectiveAddons,
} from './directory-addons';
import {
  computeTrialEnd,
  coerceTrialUnit,
  daysRemainingInTrial,
  deriveTrialStatus,
  planHasTrial,
  readPlanTrialConfig,
  type PlanTrialConfig,
  type VenueTrialState,
} from './directory-trial';

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
  trial_period_value: number;
  trial_period_unit: PlanTrialConfig['trial_period_unit'];
  /** Short badge label shown on plan cards, e.g. "Recommended". NULL = no badge. */
  highlight_label: string | null;
  /**
   * When true this is a legacy / grandfathered plan. Venues on it get all
   * add-ons automatically, pay nothing through the platform, and see a
   * locked billing page that explains billing is handled directly.
   */
  is_legacy: boolean;
};

// ── Dynamic addon price loader ─────────────────────────────────────────────

/**
 * Load admin-configurable addon prices from the DB.
 * Falls back to DEFAULT_ADDON_PRICES if the table doesn't exist yet or a
 * row is missing — ensures zero breakage before migration 097 is applied.
 *
 * Export so billing API routes can call it before computing a charge.
 */
export async function loadAddonPrices(): Promise<AddonPrices> {
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_addon_prices')
      .select('key, price_cents');
    if (error || !data) return { ...DEFAULT_ADDON_PRICES };
    const map: Record<string, number> = {};
    for (const row of data as { key: string; price_cents: number }[]) {
      map[row.key] = row.price_cents;
    }
    return {
      verified_cents:  map.verified  ?? VERIFIED_PRICE_CENTS,
      sponsored_cents: map.sponsored ?? SPONSORED_PRICE_CENTS,
      concierge_cents: map.concierge ?? CONCIERGE_PRICE_CENTS,
    };
  } catch {
    return { ...DEFAULT_ADDON_PRICES };
  }
}

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
  /** Effective addon state (user toggles + plan-included resolved together). */
  addons: EffectiveAddons;
  /** Pricing breakdown for the current plan + active addons. */
  charge: ChargeBreakdown;
  /** Inclusion flags per plan id, for the addon-checkbox UI. */
  plan_addon_inclusion: Record<string, { verified: boolean; sponsored: boolean }>;
  /** Static add-on prices in cents, exposed so the page never has to import constants. */
  addon_prices: { verified_cents: number; sponsored_cents: number; concierge_cents: number };
  /** Trial state snapshot for the current venue (if any). */
  trial: {
    status: 'none' | 'active' | 'forever' | 'expired';
    started_at: string | null;
    ends_at: string | null;
    is_forever: boolean;
    days_remaining: number | null; // null when status is none
    plan_id: string | null;
  };
  /**
   * True when the current plan is a legacy / grandfathered plan. Billing is
   * managed directly — no subscription required, all add-ons included.
   */
  is_legacy_plan: boolean;
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
    trial_period_value:
      typeof row.trial_period_value === 'number' ? (row.trial_period_value as number) : 0,
    trial_period_unit: coerceTrialUnit(row.trial_period_unit as string | null),
    highlight_label:
      typeof row.highlight_label === 'string' && row.highlight_label.trim()
        ? row.highlight_label.trim()
        : null,
    is_legacy: Boolean(row.is_legacy),
  };
}

export async function listDirectoryPlanCatalog(opts?: {
  /**
   * When true, only plans with is_public = true are returned.
   * Falls back gracefully if migration 094 hasn't been applied yet
   * (in that case all plans are treated as public).
   * Defaults to false to avoid breaking internal billing-math callers
   * that need the full catalog regardless of visibility.
   */
  publicOnly?: boolean;
  /**
   * If provided, this plan ID is always included in the result even if
   * it would otherwise be filtered out (e.g. it's a hidden legacy plan
   * that a venue is currently subscribed to — we still need to show it).
   */
  alwaysIncludeId?: string;
}): Promise<DirectoryPlanCatalogEntry[]> {
  const { publicOnly = false, alwaysIncludeId } = opts ?? {};

  const baseColumns =
    'id, name, slug, description, price_monthly_cents, is_default, sort_order, feature_flags';
  const fullColumns = `${baseColumns}, trial_period_value, trial_period_unit, is_public, highlight_label, is_legacy`;

  let rows: Record<string, unknown>[] | null = null;

  const buildQuery = (cols: string) => {
    let q = supabaseAdmin
      .from('directory_plans')
      .select(cols)
      .order('price_monthly_cents', { ascending: true, nullsFirst: true })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    // Only filter at the DB level when migration 094 is confirmed applied
    // (we detect that below). For now always fetch all and post-filter.
    return q;
  };

  const full = await buildQuery(fullColumns);

  if (full.error) {
    // Pre-migration fallback: drop unknown columns and re-query
    const slimColumns =
      /trial_period_(value|unit)/.test(full.error.message)
        ? baseColumns
        : `${baseColumns}, trial_period_value, trial_period_unit`;
    const slim = await buildQuery(slimColumns);
    rows = (slim.data ?? null) as unknown as Record<string, unknown>[] | null;
  } else {
    rows = (full.data ?? null) as unknown as Record<string, unknown>[] | null;
  }

  const allMapped = (rows ?? []).map((r) => mapPlanRow(r));

  // Post-filter by is_public. If the column didn't come back (pre-094) every
  // plan is treated as public so the picker still shows everything.
  if (!publicOnly) return allMapped;

  const columnExists = rows && rows.length > 0 && 'is_public' in (rows[0] as object);
  if (!columnExists) {
    // Migration 094 not yet applied — treat all plans as public
    return allMapped;
  }

  const filtered = allMapped.filter((p) => {
    const raw = (rows!.find((r) => String(r.id) === p.id) ?? {}) as Record<string, unknown>;
    return raw.is_public !== false; // null/undefined treated as public
  });

  // Always include the alwaysIncludeId plan even if hidden
  if (alwaysIncludeId && !filtered.find((p) => p.id === alwaysIncludeId)) {
    const pinned = allMapped.find((p) => p.id === alwaysIncludeId);
    if (pinned) filtered.push(pinned);
  }

  return filtered;
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
  // Only show public plans on the billing page. If the venue is already on a
  // hidden/legacy plan we still pin it in the list so their card renders.
  const plans = await listDirectoryPlanCatalog({
    publicOnly:       true,
    alwaysIncludeId:  ctx?.venue?.directory_plan_id ?? undefined,
  });
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

  // Pull stored addon flags + trial state. Resilient to columns not existing
  // yet — mirrors how pricing-guide handles its schema-not-yet-applied case.
  let addonVerifiedUser   = false;
  let addonSponsoredUser  = false;
  let addonConciergeUser  = false;
  let trialState: VenueTrialState = {
    directory_trial_started_at: null,
    directory_trial_ends_at: null,
    directory_trial_is_forever: false,
    directory_trial_plan_id: null,
    directory_trial_consumed: false,
  };
  try {
    const { data: addonRow } = await supabaseAdmin
      .from('venues')
      .select(
        'directory_addon_verified, directory_addon_sponsored, directory_addon_concierge, directory_trial_started_at, directory_trial_ends_at, directory_trial_is_forever, directory_trial_plan_id, directory_trial_consumed',
      )
      .eq('id', venueId)
      .maybeSingle();
    if (addonRow) {
      const r = addonRow as Record<string, unknown>;
      addonVerifiedUser  = Boolean(r.directory_addon_verified);
      addonSponsoredUser = Boolean(r.directory_addon_sponsored);
      addonConciergeUser = Boolean(r.directory_addon_concierge);
      trialState = {
        directory_trial_started_at: (r.directory_trial_started_at as string | null) ?? null,
        directory_trial_ends_at: (r.directory_trial_ends_at as string | null) ?? null,
        directory_trial_is_forever: Boolean(r.directory_trial_is_forever),
        directory_trial_plan_id: (r.directory_trial_plan_id as string | null) ?? null,
        directory_trial_consumed: Boolean(r.directory_trial_consumed),
      };
    }
  } catch {
    // Schema not yet applied — treat as unset until migrations 092/093 run.
  }
  // Pre-migration fallback for venues where addon columns exist but trial doesn't.
  if (!trialState.directory_trial_started_at && !trialState.directory_trial_ends_at) {
    try {
      const { data: addonOnly } = await supabaseAdmin
        .from('venues')
        .select('directory_addon_verified, directory_addon_sponsored, directory_addon_concierge')
        .eq('id', venueId)
        .maybeSingle();
      if (addonOnly) {
        const r = addonOnly as Record<string, unknown>;
        addonVerifiedUser  = Boolean(r.directory_addon_verified);
        addonSponsoredUser = Boolean(r.directory_addon_sponsored);
        addonConciergeUser = Boolean(r.directory_addon_concierge);
      }
    } catch {
      // ignore
    }
  }

  const addonPrices = await loadAddonPrices();

  const isLegacyPlan = Boolean(current?.is_legacy);

  // Legacy plan: all add-ons auto-included, no platform charge.
  const addons: EffectiveAddons = isLegacyPlan
    ? {
        verified:            true,
        sponsored:           true,
        concierge:           true,
        verifiedFromPlan:    true,
        sponsoredFromPlan:   true,
        conciergeFromPlan:   true,
        conciergeAvailable:  true,
        verifiedUser:        false,
        sponsoredUser:       false,
        conciergeUser:       false,
      }
    : resolveEffectiveAddons({
        plan: current,
        allPlans: plans,
        addonVerifiedUser,
        addonSponsoredUser,
        addonConciergeUser,
      });

  const charge: ChargeBreakdown = isLegacyPlan
    ? { plan_cents: 0, verified_cents: 0, sponsored_cents: 0, concierge_cents: 0, total_cents: 0 }
    : computeMonthlyTotalCents({
        plan: current,
        allPlans: plans,
        addonVerifiedUser,
        addonSponsoredUser,
        addonConciergeUser,
        prices: addonPrices,
      });

  const plan_addon_inclusion: Record<string, { verified: boolean; sponsored: boolean }> = {};
  for (const p of plans) {
    plan_addon_inclusion[p.id] = {
      verified: resolveEffectiveAddons({
        plan: p,
        allPlans: plans,
        addonVerifiedUser: false,
        addonSponsoredUser: false,
      }).verifiedFromPlan,
      sponsored: resolveEffectiveAddons({
        plan: p,
        allPlans: plans,
        addonVerifiedUser: false,
        addonSponsoredUser: false,
      }).sponsoredFromPlan,
    };
  }

  const trialStatus = deriveTrialStatus(trialState);
  const daysRemaining =
    trialStatus === 'active'
      ? daysRemainingInTrial(trialState)
      : trialStatus === 'forever'
        ? Infinity
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
    addons,
    charge,
    plan_addon_inclusion,
    addon_prices: addonPrices,
    trial: {
      status: trialStatus,
      started_at: trialState.directory_trial_started_at,
      ends_at: trialState.directory_trial_ends_at,
      is_forever: trialState.directory_trial_is_forever,
      // Infinity → null so JSON serialization doesn't blow up
      days_remaining: daysRemaining === Infinity ? null : daysRemaining,
      plan_id: trialState.directory_trial_plan_id,
    },
    is_legacy_plan: isLegacyPlan,
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

  // Try with trial fields first; fall back if migration 093 hasn't run.
  let targetRow: Record<string, unknown> | null = null;
  const fullSelect = 'id, name, price_monthly_cents, fortis_merchant_id, feature_flags, trial_period_value, trial_period_unit';
  const slimSelect = 'id, name, price_monthly_cents, fortis_merchant_id, feature_flags';
  const fullResp = await supabaseAdmin
    .from('directory_plans')
    .select(fullSelect)
    .eq('id', targetPlanId)
    .maybeSingle();
  if (fullResp.error && /trial_period_(value|unit)/.test(fullResp.error.message)) {
    const slimResp = await supabaseAdmin
      .from('directory_plans')
      .select(slimSelect)
      .eq('id', targetPlanId)
      .maybeSingle();
    targetRow = (slimResp.data ?? null) as unknown as Record<string, unknown> | null;
  } else {
    targetRow = (fullResp.data ?? null) as unknown as Record<string, unknown> | null;
  }
  if (!targetRow) throw new Error('Plan not found');

  const target = targetRow as unknown as VenuePlanRow['plan'];
  if (!target) throw new Error('Plan not found');
  // The wider plan row used by the addon math helper. The DB query above
  // selected feature_flags, so we know the shape — cast through unknown.
  const targetForMath = targetRow as unknown as DirectoryPlanCatalogEntry;
  const targetTrialConfig = readPlanTrialConfig(targetRow);

  if (ctx.venue.directory_plan_id === target.id) {
    return { kind: 'switched', plan_id: target.id };
  }

  // Pull existing addon flags + trial state so the recalculated subscription
  // amount stays in sync. Defensive in case migrations 092/093 haven't run.
  let addonVerifiedUser = false;
  let addonSponsoredUser = false;
  let trialConsumed = false;
  let activeTrialEndsAt: Date | null = null;
  let activeTrialIsForever = false;
  try {
    const { data: row } = await supabaseAdmin
      .from('venues')
      .select(
        'directory_addon_verified, directory_addon_sponsored, directory_trial_consumed, directory_trial_ends_at, directory_trial_is_forever',
      )
      .eq('id', venueId)
      .maybeSingle();
    if (row) {
      const r = row as Record<string, unknown>;
      addonVerifiedUser = Boolean(r.directory_addon_verified);
      addonSponsoredUser = Boolean(r.directory_addon_sponsored);
      trialConsumed = Boolean(r.directory_trial_consumed);
      activeTrialIsForever = Boolean(r.directory_trial_is_forever);
      const endsRaw = r.directory_trial_ends_at as string | null | undefined;
      if (endsRaw) {
        const d = new Date(endsRaw);
        if (!Number.isNaN(d.getTime())) activeTrialEndsAt = d;
      }
    }
  } catch {
    // pre-migration — trial fields treated as unset
  }
  const now = new Date();
  const trialIsActive =
    activeTrialIsForever || (activeTrialEndsAt !== null && activeTrialEndsAt.getTime() > now.getTime());

  const allPlans = await listDirectoryPlanCatalog();
  const currentForMath = ctx.plan
    ? (allPlans.find((p) => p.id === ctx.plan!.id) ?? (ctx.plan as unknown as DirectoryPlanCatalogEntry))
    : null;
  const targetCharge = computeMonthlyTotalCents({
    plan: targetForMath,
    allPlans,
    addonVerifiedUser,
    addonSponsoredUser,
  });
  const currentCharge = computeMonthlyTotalCents({
    plan: currentForMath,
    allPlans,
    addonVerifiedUser,
    addonSponsoredUser,
  });

  const newCents = targetCharge.total_cents;
  const currentCents = currentCharge.total_cents;
  const subId = ctx.venue.directory_subscription_external_id;
  const status = ctx.venue.directory_subscription_status;
  const hasActiveSub = Boolean(subId && (status === 'active' || status === 'trialing' || status === 'past_due'));

  // Total billable goes to zero (free plan AND no add-ons left active).
  // Cancel the sub and clear status. Note: addons on a free plan can keep a
  // subscription alive, so we check the *total*, not the plan price.
  if (newCents <= 0) {
    if (hasActiveSub && subId) {
      const secret = getPlatformLunarPaySecretKey();
      if (secret) {
        try {
          await cancelSubscription(secret, subId);
        } catch {
          throw new Error('Could not cancel current subscription. Try again or contact support.');
        }
      }
      await recordBillingEvent(
        venueId,
        ctx.plan?.id || null,
        0,
        'subscription_cancel',
        `plan_change:${Date.now()}:${venueId}`,
        { reason: 'total_charge_zero', previous_subscription_id: subId },
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

  // ── Trial grant ────────────────────────────────────────────────────────
  // Venue is moving to a paid plan, has no active LunarPay subscription, and
  // the target plan offers a trial. If they haven't consumed their trial yet,
  // grant it: snapshot the trial duration onto the venue, set status to
  // 'trialing', and SKIP checkout. They use the plan free until trial ends —
  // at which point they need to add a card (handled by /api/venue-billing/
  // start-trial-payment or the LunarPay-checkout flow on demand).
  //
  // If trial is currently active (e.g. user upgrades from one trial-eligible
  // plan to another within the trial window), preserve the existing trial
  // end date — they don't get a fresh trial, just a different plan.
  const grantingFreshTrial = !trialConsumed && planHasTrial(targetTrialConfig);
  const stillInActiveTrial = trialIsActive;
  if (!hasActiveSub && (grantingFreshTrial || stillInActiveTrial)) {
    let endsAt: Date | null = activeTrialEndsAt;
    let forever = activeTrialIsForever;
    let startedAt: string | null = null;
    if (grantingFreshTrial) {
      const t = computeTrialEnd(targetTrialConfig, now);
      endsAt = t.endsAt;
      forever = t.forever;
      startedAt = now.toISOString();
    }

    const update: Record<string, unknown> = {
      directory_plan_id: target.id,
      directory_subscription_status: 'trialing',
      directory_subscription_external_id: null,
    };
    if (grantingFreshTrial) {
      update.directory_trial_started_at = startedAt;
      update.directory_trial_ends_at = endsAt ? endsAt.toISOString() : null;
      update.directory_trial_is_forever = forever;
      update.directory_trial_plan_id = target.id;
      update.directory_trial_consumed = true;
    }

    let upd = await supabaseAdmin.from('venues').update(update).eq('id', venueId);
    // Pre-migration safety net.
    if (upd.error && /directory_trial_/.test(upd.error.message)) {
      const slim: Record<string, unknown> = {
        directory_plan_id: target.id,
        directory_subscription_status: 'trialing',
        directory_subscription_external_id: null,
      };
      upd = await supabaseAdmin.from('venues').update(slim).eq('id', venueId);
    }

    await recordBillingEvent(
      venueId,
      target.id,
      0,
      grantingFreshTrial ? 'trial_started' : 'plan_change_during_trial',
      `trial:${target.id}:${venueId}:${Date.now()}`,
      {
        previous_plan_id: ctx.plan?.id || null,
        new_plan_id: target.id,
        trial_ends_at: endsAt ? endsAt.toISOString() : null,
        trial_forever: forever,
        plan_target_amount_cents: newCents,
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
  // No metadata: LP currently 500s when checkout sessions include it.
  // The pending plan id is persisted on the venue row below, so verify can
  // recover the context from cookie + DB.
  const checkoutData: Record<string, unknown> = {
    amount: amountDollars,
    description: `StoryVenue directory — ${target.name} (monthly)`,
    customer_email: ctx.venue.email || undefined,
    customer_name: ctx.venue.name,
    success_url: `${APP_URL}/dashboard/directory-billing`,
    cancel_url: `${APP_URL}/dashboard/directory-billing`,
  };
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
  };
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
  // No metadata: LP currently 500s when checkout sessions include it.
  // The flow is identified by the success URL's ?payment_update=1 marker;
  // the venue is identified by cookie at verify time.
  const secret = requirePlatformLunarPaySecretKey();
  const checkoutData: Record<string, unknown> = {
    amount: cents / 100,
    description: `StoryVenue directory — ${ctx.plan.name} (update card)`,
    customer_email: ctx.venue.email || undefined,
    customer_name: ctx.venue.name,
    success_url: `${APP_URL}/dashboard/directory-billing?payment_update=1`,
    cancel_url: `${APP_URL}/dashboard/directory-billing`,
  };
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

  // Create the replacement subscription directly inline so we can wire it
  // to the freshly saved payment method.
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
