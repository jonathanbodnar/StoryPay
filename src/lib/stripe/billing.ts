/**
 * StoryVenue SaaS billing on Stripe (the owner's existing Stripe account).
 *
 * Mirrors what the LunarPay code in venue-billing.ts / platform-directory-billing.ts
 * does, so every dashboard gate keeps working unchanged:
 *   • directory_subscription_status  trialing | active | past_due | canceled | none | pending
 *   • directory_subscription_external_id = the Stripe subscription id (sub_…)
 *   • billing_provider = 'stripe', stripe_customer_id, stripe_subscription_id
 *
 * Differences that matter:
 *   • Status comes from webhooks (lib/stripe/webhooks.ts), not from polling.
 *   • A plan / add-on change updates the subscription's items with no proration
 *     (same effect as LunarPay's cancel-and-recreate rollover).
 *   • The owner's private clients already exist as Stripe customers. We reuse the
 *     customer matched by email, and we never change that customer's default card:
 *     the SaaS subscription carries its own default_payment_method, so the
 *     owner's other subscriptions and manual charges are untouched.
 *   • Only subscriptions tagged `metadata.sv_kind = 'saas'` (or linked on the
 *     venue row) are ever read or changed here.
 */

import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { getStripe, isStripeConfigured, stripeBillingEnabledFor } from '@/lib/stripe/client';
import { computeMonthlyTotalCents } from '@/lib/directory-addons';
import { scheduleOwnerGhlSync } from '@/lib/owner-ghl-sync';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');

export const SAAS_KIND = 'saas';

// ── Venue row ────────────────────────────────────────────────────────────────

export interface BillingVenue {
  id: string;
  slug: string | null;
  name: string | null;
  email: string | null;
  notification_email: string | null;
  directory_plan_id: string | null;
  directory_subscription_status: string | null;
  directory_subscription_external_id: string | null;
  billing_provider: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  directory_trial_started_at: string | null;
  directory_trial_ends_at: string | null;
  directory_trial_consumed: boolean | null;
  directory_downgrade_at: string | null;
  directory_card_on_file: boolean | null;
  directory_trial_reminder_sent_at: string | null;
  directory_addon_verified: boolean | null;
  directory_addon_sponsored: boolean | null;
  directory_addon_concierge: boolean | null;
}

const VENUE_COLUMNS =
  'id, slug, name, email, notification_email, directory_plan_id, directory_subscription_status, ' +
  'directory_subscription_external_id, billing_provider, stripe_customer_id, stripe_subscription_id, ' +
  'directory_trial_started_at, directory_trial_ends_at, directory_trial_consumed, directory_downgrade_at, ' +
  'directory_card_on_file, directory_trial_reminder_sent_at, directory_addon_verified, ' +
  'directory_addon_sponsored, directory_addon_concierge';

export async function loadBillingVenue(venueId: string): Promise<BillingVenue | null> {
  const { data, error } = await supabaseAdmin.from('venues').select(VENUE_COLUMNS).eq('id', venueId).maybeSingle();
  if (error) throw new Error(`Could not load venue billing row: ${error.message}`);
  return (data as unknown as BillingVenue | null) ?? null;
}

/**
 * Does this venue bill (or start billing) on Stripe?
 *   • 'stripe' → yes, always.  'lunarpay' → no, until it's moved.
 *   • No provider yet: a LunarPay subscription id on file still means LunarPay
 *     (Stripe ids start with sub_); otherwise the rollout switch decides.
 */
export function venueBillsOnStripe(
  v: Pick<BillingVenue, 'billing_provider' | 'directory_subscription_external_id' | 'id' | 'slug' | 'email' | 'notification_email'>,
): boolean {
  if (v.billing_provider === 'stripe') return true;
  if (v.billing_provider === 'lunarpay') return false;
  const ext = v.directory_subscription_external_id;
  if (ext && !String(ext).startsWith('sub_')) return false;
  return stripeBillingEnabledFor(v);
}

export async function isStripeBillingVenue(venueId: string): Promise<boolean> {
  const v = await loadBillingVenue(venueId);
  return Boolean(v && venueBillsOnStripe(v));
}

/** Is the billing system this venue uses configured on the server? */
export async function saasBillingConfiguredFor(venueId: string): Promise<boolean> {
  if (await isStripeBillingVenue(venueId)) return isStripeConfigured();
  const { isPlatformDirectoryBillingConfigured } = await import('@/lib/platform-directory-billing');
  return isPlatformDirectoryBillingConfigured();
}

async function updateVenue(venueId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from('venues').update(patch).eq('id', venueId);
  if (error) throw new Error(`Could not update venue billing row: ${error.message}`);
}

export async function recordStripeBillingEvent(opts: {
  venueId: string;
  planId: string | null;
  amountCents: number;
  eventType: string;
  externalEventId: string;
  invoiceId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('platform_billing_events')
    .select('id')
    .eq('external_event_id', opts.externalEventId)
    .maybeSingle();
  if (existing) return;
  const { error } = await supabaseAdmin.from('platform_billing_events').insert({
    venue_id: opts.venueId,
    directory_plan_id: opts.planId,
    amount_cents: opts.amountCents,
    currency: 'usd',
    external_event_id: opts.externalEventId,
    event_type: opts.eventType,
    provider: 'stripe',
    stripe_invoice_id: opts.invoiceId ?? null,
    metadata: opts.metadata ?? {},
  });
  if (error) console.warn('[stripe-billing] billing event insert failed:', error.message);
}

// ── Customer ─────────────────────────────────────────────────────────────────

/**
 * The venue's Stripe customer. Reuses an existing customer with the owner's
 * email (private clients are already customers) before creating one.
 */
export async function ensureStripeCustomer(v: BillingVenue): Promise<string> {
  if (v.stripe_customer_id) return v.stripe_customer_id;
  const stripe = getStripe();
  const emails = Array.from(
    new Set([v.email, v.notification_email].map((e) => (e ?? '').trim().toLowerCase()).filter(Boolean)),
  );

  let found: Stripe.Customer | null = null;
  for (const email of emails) {
    const list = await stripe.customers.list({ email, limit: 10 });
    const live = list.data.filter((c) => !(c as unknown as { deleted?: boolean }).deleted);
    if (live.length) {
      found = live.find((c) => c.invoice_settings?.default_payment_method) ?? live[0];
      break;
    }
  }

  let customerId: string;
  if (found) {
    customerId = found.id;
    // Tag it (adds a key; the customer's other metadata is left as is).
    await stripe.customers.update(customerId, { metadata: { storyvenue_venue_id: v.id } }).catch(() => {});
  } else {
    const created = await stripe.customers.create(
      {
        email: emails[0] || undefined,
        name: v.name || undefined,
        metadata: { storyvenue_venue_id: v.id },
      },
      { idempotencyKey: `sv-customer-${v.id}` },
    );
    customerId = created.id;
  }
  await updateVenue(v.id, { stripe_customer_id: customerId });
  v.stripe_customer_id = customerId;
  return customerId;
}

// ── Prices ───────────────────────────────────────────────────────────────────

const priceCache = new Map<string, { id: string; amount: number }>();

/**
 * A monthly Price for a plan or add-on at the given amount. Prices are
 * immutable, so when the amount changes a new Price takes over the lookup key.
 */
async function ensurePrice(key: string, name: string, unitAmount: number): Promise<string> {
  const lookupKey = `sv_saas_${key}_monthly`;
  const cached = priceCache.get(lookupKey);
  if (cached && cached.amount === unitAmount) return cached.id;

  const stripe = getStripe();
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const hit = existing.data[0];
  if (hit && hit.unit_amount === unitAmount && hit.recurring?.interval === 'month') {
    priceCache.set(lookupKey, { id: hit.id, amount: unitAmount });
    return hit.id;
  }

  const productId = `sv_saas_${key}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  try {
    await stripe.products.retrieve(productId);
    await stripe.products.update(productId, { name }).catch(() => {});
  } catch {
    await stripe.products.create({ id: productId, name, metadata: { sv_kind: SAAS_KIND } });
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: unitAmount,
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    metadata: { sv_kind: SAAS_KIND, sv_key: key },
  });
  priceCache.set(lookupKey, { id: price.id, amount: unitAmount });
  return price.id;
}

export interface DesiredItem {
  key: string;
  name: string;
  amountCents: number;
}

/** The plan + paid add-ons for a venue, the same math LunarPay billing uses. */
export async function desiredItemsFor(
  v: BillingVenue,
  planIdOverride?: string | null,
): Promise<{ items: DesiredItem[]; totalCents: number; planId: string | null; planName: string | null }> {
  const { listDirectoryPlanCatalog, loadAddonPrices } = await import('@/lib/venue-billing');
  const [allPlans, prices] = await Promise.all([listDirectoryPlanCatalog(), loadAddonPrices()]);
  const planId = planIdOverride === undefined ? v.directory_plan_id : planIdOverride;
  const plan = allPlans.find((p) => p.id === planId) ?? null;
  if (!plan || plan.is_legacy) return { items: [], totalCents: 0, planId: plan?.id ?? null, planName: plan?.name ?? null };

  const charge = computeMonthlyTotalCents({
    plan,
    allPlans,
    addonVerifiedUser: Boolean(v.directory_addon_verified),
    addonSponsoredUser: Boolean(v.directory_addon_sponsored),
    addonConciergeUser: Boolean(v.directory_addon_concierge),
    prices,
  });
  const items: DesiredItem[] = [];
  if (charge.plan_cents > 0) items.push({ key: `plan_${plan.slug || plan.id}`, name: `StoryVenue — ${plan.name}`, amountCents: charge.plan_cents });
  if (charge.verified_cents > 0) items.push({ key: 'addon_verified', name: 'StoryVenue — Verified Listing', amountCents: charge.verified_cents });
  if (charge.sponsored_cents > 0) items.push({ key: 'addon_sponsored', name: 'StoryVenue — Sponsored Listing', amountCents: charge.sponsored_cents });
  if (charge.concierge_cents > 0) items.push({ key: 'addon_concierge', name: 'StoryVenue — Venue Concierge', amountCents: charge.concierge_cents });
  return { items, totalCents: charge.total_cents, planId: plan.id, planName: plan.name };
}

export async function priceIdsForItems(items: DesiredItem[]): Promise<string[]> {
  return Promise.all(items.map((i) => ensurePrice(i.key, i.name, i.amountCents)));
}
const priceIdsFor = priceIdsForItems;

// ── Status mapping ───────────────────────────────────────────────────────────

/** Stripe subscription status → the venue's directory_subscription_status. */
export function venueStatusFor(sub: Pick<Stripe.Subscription, 'status'>): string {
  switch (sub.status) {
    case 'trialing': return 'trialing';
    case 'active': return 'active';
    case 'past_due':
    case 'unpaid':
    case 'paused': return 'past_due';
    case 'incomplete': return 'pending';
    default: return 'canceled';
  }
}

function toUnix(iso: string | Date): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

// ── Card collection (onboarding modal) ───────────────────────────────────────

/** A SetupIntent for the embedded card form. */
export async function createCardSetupIntent(venueId: string): Promise<{ clientSecret: string }> {
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  const customer = await ensureStripeCustomer(v);
  const si = await getStripe().setupIntents.create({
    customer,
    usage: 'off_session',
    payment_method_types: ['card'],
    metadata: { storyvenue_venue_id: v.id, sv_kind: SAAS_KIND },
  });
  if (!si.client_secret) throw new Error('Stripe did not return a client secret.');
  return { clientSecret: si.client_secret };
}

async function paymentMethodFromSetupIntent(v: BillingVenue, setupIntentId: string): Promise<{ customer: string; paymentMethod: string }> {
  const customer = await ensureStripeCustomer(v);
  const si = await getStripe().setupIntents.retrieve(setupIntentId);
  const siCustomer = typeof si.customer === 'string' ? si.customer : si.customer?.id;
  if (siCustomer !== customer || si.metadata?.storyvenue_venue_id !== v.id) {
    throw new Error('That card setup does not belong to this venue.');
  }
  if (si.status !== 'succeeded') throw new Error('Your card was not confirmed. Please try again.');
  const paymentMethod = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
  if (!paymentMethod) throw new Error('Stripe did not return the saved card.');

  // A brand-new customer gets this card as their default. An existing customer
  // (e.g. a private client) keeps theirs — the SaaS subscription names its own card.
  const cust = await getStripe().customers.retrieve(customer);
  if (!(cust as Stripe.Customer).deleted && !(cust as Stripe.Customer).invoice_settings?.default_payment_method) {
    await getStripe().customers.update(customer, { invoice_settings: { default_payment_method: paymentMethod } }).catch(() => {});
  }
  return { customer, paymentMethod };
}

export type ConfirmCardResult =
  | { ok: true; plan: 'free'; persisted: boolean; already_processed?: boolean }
  | { ok: true; plan: 'pro'; persisted: boolean; subscription_id: string; trial_ends_at: string | null; already_processed?: boolean };

/**
 * The card form succeeded. Free plan: card on file, no subscription.
 * Pro plan: start the subscription with its first charge at the trial end.
 * Writes exactly the venue fields the LunarPay confirm routes write.
 */
export async function confirmCardAndStart(venueId: string, setupIntentId: string, plan: 'free' | 'pro'): Promise<ConfirmCardResult> {
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  const { trackEvent } = await import('@/lib/analytics');
  const { autoVerifyGbpVenue } = await import('@/lib/directory-badges');

  if (plan === 'free') {
    if (v.directory_card_on_file === true && v.billing_provider === 'stripe') {
      return { ok: true, plan: 'free', persisted: true, already_processed: true };
    }
    const { customer, paymentMethod } = await paymentMethodFromSetupIntent(v, setupIntentId);
    const { resolveFreePlan } = await import('@/lib/trial-plans');
    const freePlan = await resolveFreePlan();
    let persisted = true;
    try {
      await updateVenue(venueId, {
        billing_provider: 'stripe',
        stripe_customer_id: customer,
        stripe_subscription_id: null,
        directory_card_on_file: true,
        directory_subscription_status: 'none',
        directory_subscription_external_id: null,
        directory_trial_started_at: null,
        directory_trial_ends_at: null,
        directory_trial_is_forever: true,
        directory_trial_consumed: true,
        directory_downgrade_at: null,
        ...(freePlan ? { directory_plan_id: freePlan.id } : {}),
      });
    } catch (e) {
      persisted = false;
      console.error('[stripe-billing] free confirm: venue update failed', e);
    }
    try {
      const { cancelReengagementDrip } = await import('@/lib/reengagement-drip');
      await cancelReengagementDrip(venueId, 'converted');
    } catch { /* non-fatal */ }
    if (persisted) await autoVerifyGbpVenue(venueId);
    await recordStripeBillingEvent({
      venueId,
      planId: freePlan?.id ?? null,
      amountCents: 0,
      eventType: 'signup_card_vaulted_free',
      externalEventId: `stripe_signup_free:${venueId}:${setupIntentId}`,
      metadata: { customer_id: customer, payment_method_id: paymentMethod, setup_intent_id: setupIntentId, flow: 'stripe_elements_free' },
    });
    if (persisted) {
      await trackEvent({
        event: 'card_on_file', kind: 'milestone', venueId, role: 'owner',
        label: 'Card saved on Free plan (no subscription)',
        properties: { customerId: customer, plan: 'free', provider: 'stripe' },
      });
    }
    scheduleOwnerGhlSync(venueId);
    return { ok: true, plan: 'free', persisted };
  }

  // Pro: already done (double submit / retry)?
  if (v.stripe_subscription_id && ['trialing', 'active', 'past_due'].includes(String(v.directory_subscription_status))) {
    return {
      ok: true, plan: 'pro', persisted: true, already_processed: true,
      subscription_id: v.stripe_subscription_id, trial_ends_at: v.directory_trial_ends_at,
    };
  }
  if (!v.directory_plan_id || !v.directory_trial_ends_at) throw new Error('Trial not set up. Please restart signup.');

  const { customer, paymentMethod } = await paymentMethodFromSetupIntent(v, setupIntentId);
  const desired = await desiredItemsFor(v);
  if (desired.totalCents <= 0) throw new Error('Plan total is $0 — no card needed.');
  const prices = await priceIdsFor(desired.items);

  const trialEnd = toUnix(v.directory_trial_ends_at);
  const nowUnix = Math.floor(Date.now() / 1000);
  const sub = await getStripe().subscriptions.create(
    {
      customer,
      items: prices.map((price) => ({ price })),
      default_payment_method: paymentMethod,
      ...(trialEnd > nowUnix + 60 ? { trial_end: trialEnd } : {}),
      proration_behavior: 'none',
      payment_behavior: trialEnd > nowUnix + 60 ? 'allow_incomplete' : 'error_if_incomplete',
      description: `StoryVenue — ${desired.planName ?? 'subscription'} (monthly)`,
      metadata: { storyvenue_venue_id: v.id, sv_kind: SAAS_KIND, plan_id: desired.planId ?? '' },
    },
    { idempotencyKey: `sv-sub-${v.id}-${setupIntentId}` },
  );

  const trialStartedAt = v.directory_trial_started_at || new Date().toISOString();
  let persisted = true;
  try {
    await updateVenue(venueId, {
      billing_provider: 'stripe',
      stripe_customer_id: customer,
      stripe_subscription_id: sub.id,
      directory_subscription_external_id: sub.id,
      directory_subscription_status: venueStatusFor(sub),
      directory_trial_started_at: trialStartedAt,
      directory_trial_ends_at: v.directory_trial_ends_at,
      directory_trial_is_forever: false,
      directory_trial_plan_id: v.directory_plan_id,
      directory_trial_consumed: true,
      directory_card_on_file: true,
      ...(v.directory_addon_verified ? { directory_verified_status: 'approved' } : {}),
      ...(v.directory_addon_sponsored ? { directory_sponsored_status: 'approved' } : {}),
    });
  } catch (e) {
    persisted = false;
    console.error('[stripe-billing] pro confirm: venue update failed', e, { venueId, subId: sub.id });
  }

  await recordStripeBillingEvent({
    venueId,
    planId: v.directory_plan_id,
    amountCents: 0,
    eventType: 'subscription_signup_trial_start',
    externalEventId: `stripe_signup:${venueId}:${sub.id}`,
    metadata: {
      subscription_id: sub.id, customer_id: customer, payment_method_id: paymentMethod,
      setup_intent_id: setupIntentId, trial_ends_at: v.directory_trial_ends_at,
      monthly_cents: desired.totalCents, flow: 'stripe_elements', venue_row_persisted: persisted,
    },
  });
  if (persisted) {
    await trackEvent({
      event: 'card_on_file', kind: 'milestone', venueId, role: 'owner',
      label: 'Card saved + trial subscription created',
      properties: { subId: sub.id, monthlyCents: desired.totalCents, provider: 'stripe' },
    });
    await autoVerifyGbpVenue(venueId);
  } else {
    await trackEvent({
      event: 'go_live_persist_failed', kind: 'milestone', venueId, role: 'owner',
      label: 'Card saved but venue row write failed — venue may be stuck behind go-live gate',
      properties: { subId: sub.id, customerId: customer, provider: 'stripe' },
    });
  }
  scheduleOwnerGhlSync(venueId);
  return { ok: true, plan: 'pro', persisted, subscription_id: sub.id, trial_ends_at: v.directory_trial_ends_at };
}

// ── Hosted checkout (add a card later, upgrade from Free, update card) ──────

/**
 * Stripe-hosted Checkout that starts the subscription — used where LunarPay's
 * hosted checkout was: the trial-expired wall, upgrading with no subscription,
 * resuming a pending upgrade, add-ons from Free.
 */
export async function createSubscriptionCheckout(
  venueId: string,
  opts: { purpose: string; nextPath?: string; planIdOverride?: string | null } = { purpose: 'subscribe' },
): Promise<{ url: string }> {
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  const customer = await ensureStripeCustomer(v);
  const desired = await desiredItemsFor(v, opts.planIdOverride);
  if (desired.totalCents <= 0) throw new Error('Free plans do not require checkout.');
  const prices = await priceIdsFor(desired.items);

  // Keep an unfinished trial's first-charge date. Stripe Checkout needs a trial
  // end at least 48h out; closer than that, billing simply starts now.
  const trialEnds = v.directory_trial_ends_at ? new Date(v.directory_trial_ends_at).getTime() : 0;
  const keepTrial = v.directory_subscription_status === 'trialing' && trialEnds > Date.now() + 49 * 3600 * 1000;

  const next = opts.nextPath || '/dashboard/directory-billing';
  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: v.id,
    line_items: prices.map((price) => ({ price, quantity: 1 })),
    payment_method_types: ['card'],
    subscription_data: {
      description: `StoryVenue — ${desired.planName ?? 'subscription'} (monthly)`,
      metadata: { storyvenue_venue_id: v.id, sv_kind: SAAS_KIND, plan_id: desired.planId ?? '' },
      ...(keepTrial ? { trial_end: Math.floor(trialEnds / 1000) } : {}),
    },
    metadata: { storyvenue_venue_id: v.id, sv_kind: SAAS_KIND, purpose: opts.purpose },
    success_url: `${APP_URL}/api/venue-billing/stripe/checkout-return?session_id={CHECKOUT_SESSION_ID}&next=${encodeURIComponent(next)}`,
    cancel_url: `${APP_URL}${next}`,
  });
  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return { url: session.url };
}

/** Stripe-hosted page to save a new card (mode=setup) for the SaaS subscription. */
export async function createCardUpdateCheckout(
  venueId: string,
  nextPath = '/dashboard/directory-billing',
  purpose: 'update_card' | 'lp_move' = 'update_card',
): Promise<{ url: string }> {
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  const customer = await ensureStripeCustomer(v);
  const session = await getStripe().checkout.sessions.create({
    mode: 'setup',
    customer,
    client_reference_id: v.id,
    payment_method_types: ['card'],
    currency: 'usd',
    setup_intent_data: { metadata: { storyvenue_venue_id: v.id, sv_kind: SAAS_KIND } },
    metadata: { storyvenue_venue_id: v.id, sv_kind: SAAS_KIND, purpose },
    success_url: `${APP_URL}/api/venue-billing/stripe/checkout-return?session_id={CHECKOUT_SESSION_ID}&next=${encodeURIComponent(nextPath)}`,
    cancel_url: `${APP_URL}${nextPath}`,
  });
  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return { url: session.url };
}

/**
 * Apply a finished Checkout Session (called from the return URL and from the
 * webhook — idempotent). Returns the venue it belonged to.
 */
/**
 * A payment link for a venue's software subscription (admin "Copy billing
 * link", and the venue's own checkout route): Stripe Checkout for the plan; the
 * add-a-card page for a past-due Stripe venue; or, for a venue still billed on
 * LunarPay, the add-a-card page that moves it to Stripe. Stripe links expire
 * after 24 hours. LunarPay only when Stripe isn't in use for this venue.
 */
export async function createSaasBillingLink(
  venueId: string,
  nextPath = '/dashboard/directory-billing',
): Promise<{ url: string; provider: 'stripe' | 'lunarpay' }> {
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  if (v.billing_provider === 'lunarpay') {
    if (isStripeConfigured() && stripeBillingEnabledFor(v)) {
      return { ...(await createCardUpdateCheckout(venueId, nextPath, 'lp_move')), provider: 'stripe' };
    }
  } else if (venueBillsOnStripe(v)) {
    if (!isStripeConfigured()) throw new Error('Stripe is not configured.');
    const status = v.directory_subscription_status;
    if (v.stripe_subscription_id && (status === 'active' || status === 'trialing')) {
      throw new Error('This venue already has an active subscription — there is nothing to pay.');
    }
    if (v.stripe_subscription_id && status === 'past_due') {
      return { ...(await createCardUpdateCheckout(venueId, nextPath)), provider: 'stripe' };
    }
    return { ...(await createSubscriptionCheckout(venueId, { purpose: 'billing_link', nextPath })), provider: 'stripe' };
  }
  const { createDirectoryPlatformCheckoutSession } = await import('@/lib/platform-directory-billing');
  return { ...(await createDirectoryPlatformCheckoutSession(venueId)), provider: 'lunarpay' };
}

export async function applyCheckoutSession(sessionId: string): Promise<{ venueId: string | null; purpose: string | null }> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['setup_intent'] });
  const venueId = session.metadata?.storyvenue_venue_id || session.client_reference_id || null;
  const purpose = session.metadata?.purpose || null;
  if (!venueId || session.metadata?.sv_kind !== SAAS_KIND) return { venueId: null, purpose };
  if (session.status !== 'complete') return { venueId, purpose };
  const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;

  if (session.mode === 'subscription') {
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subId) return { venueId, purpose };
    const sub = await stripe.subscriptions.retrieve(subId);
    const v = await loadBillingVenue(venueId);
    if (!v) return { venueId, purpose };
    // A different, still-live SaaS subscription on file (e.g. a double checkout)
    // is replaced by this one.
    if (v.stripe_subscription_id && v.stripe_subscription_id !== sub.id) {
      await stripe.subscriptions.cancel(v.stripe_subscription_id).catch(() => {});
    }
    const status = venueStatusFor(sub);
    await updateVenue(venueId, {
      billing_provider: 'stripe',
      ...(customer ? { stripe_customer_id: customer } : {}),
      stripe_subscription_id: sub.id,
      directory_subscription_external_id: sub.id,
      directory_subscription_status: status,
      directory_card_on_file: true,
      directory_downgrade_at: null,
      ...(status === 'active' ? { directory_trial_consumed: true } : {}),
    });
    await recordStripeBillingEvent({
      venueId,
      planId: v.directory_plan_id,
      amountCents: session.amount_total ?? 0,
      eventType: status === 'trialing' ? 'subscription_start_trial' : 'subscription_start',
      externalEventId: `stripe_checkout:${session.id}`,
      metadata: { subscription_id: sub.id, purpose },
    });
    scheduleOwnerGhlSync(venueId);
    return { venueId, purpose };
  }

  if (session.mode === 'setup') {
    const si = session.setup_intent as Stripe.SetupIntent | null;
    const pm = si && (typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id);
    if (!pm) return { venueId, purpose };
    const v = await loadBillingVenue(venueId);
    if (!v) return { venueId, purpose };
    if (purpose === 'lp_move') {
      const { migrateVenueFromLunarPay } = await import('@/lib/stripe/lunarpay-migration');
      await migrateVenueFromLunarPay(venueId, { paymentMethodId: pm, customerId: customer });
      return { venueId, purpose };
    }
    if (v.stripe_subscription_id) {
      await stripe.subscriptions.update(v.stripe_subscription_id, { default_payment_method: pm });
      // Past due: pay what's owed with the new card right away.
      if (v.directory_subscription_status === 'past_due') {
        await payOpenInvoices(v.stripe_subscription_id).catch((e) => {
          console.warn('[stripe-billing] open invoice still unpaid after card update:', e instanceof Error ? e.message : e);
        });
      }
    }
    await updateVenue(venueId, { directory_card_on_file: true });
    await recordStripeBillingEvent({
      venueId,
      planId: v.directory_plan_id,
      amountCents: 0,
      eventType: 'payment_method_updated',
      externalEventId: `stripe_card_update:${session.id}`,
      metadata: { payment_method_id: pm },
    });
    return { venueId, purpose };
  }
  return { venueId, purpose };
}

// ── Plan changes / cancellations ─────────────────────────────────────────────

/**
 * Private clients moved from LunarPay pay a plan-only price: their add-on
 * flags are on but were never billed (subscription metadata addons_not_billed).
 * Changing the plan or add-ons in the app rebuilds the subscription from those
 * flags and would raise their price, so those changes are locked until the
 * owner re-prices them. Switching to Free and cancelling stay open.
 */
export const PLAN_CHANGES_LOCKED_MESSAGE =
  'Your plan is managed by your StoryVenue team. Contact us to change your plan or add-ons.';

function subscriptionPlanChangesLocked(sub: Stripe.Subscription): boolean {
  return sub.metadata?.addons_not_billed === 'true';
}

/** Are plan and add-on changes locked for this venue? (See PLAN_CHANGES_LOCKED_MESSAGE.) */
export async function planChangesLocked(venueId: string): Promise<boolean> {
  const v = await loadBillingVenue(venueId);
  if (!v?.stripe_subscription_id) return false;
  const sub = await retrieveSaasSub(v.stripe_subscription_id);
  return sub ? subscriptionPlanChangesLocked(sub) : false;
}

async function retrieveSaasSub(subId: string): Promise<Stripe.Subscription | null> {
  try {
    const sub = await getStripe().subscriptions.retrieve(subId);
    return sub.status === 'canceled' || sub.status === 'incomplete_expired' ? null : sub;
  } catch {
    return null;
  }
}

async function cancelSubQuietly(subId: string): Promise<void> {
  try {
    await getStripe().subscriptions.cancel(subId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/no such subscription|resource_missing|already.*cancel|canceled subscription/i.test(msg)) throw e;
  }
}

/**
 * Bring the Stripe subscription's items in line with the venue's plan and
 * add-ons (already written to the venue row). No proration: the new amount
 * starts at the next renewal. A $0 total cancels the subscription.
 */
export async function syncSubscriptionItems(venueId: string): Promise<{ totalCents: number; canceled: boolean }> {
  const v = await loadBillingVenue(venueId);
  if (!v?.stripe_subscription_id) return { totalCents: 0, canceled: false };
  const desired = await desiredItemsFor(v);
  if (desired.totalCents <= 0) {
    await cancelSubQuietly(v.stripe_subscription_id);
    await updateVenue(venueId, {
      directory_subscription_status: 'none',
      directory_subscription_external_id: null,
      stripe_subscription_id: null,
    });
    return { totalCents: 0, canceled: true };
  }
  const sub = await retrieveSaasSub(v.stripe_subscription_id);
  if (!sub) throw new Error('The Stripe subscription for this venue is no longer active.');
  const wanted = await priceIdsFor(desired.items);
  const current = sub.items.data.map((it) => ({ id: it.id, price: it.price.id }));
  const changes: Stripe.SubscriptionUpdateParams.Item[] = [
    ...current.filter((c) => !wanted.includes(c.price)).map((c) => ({ id: c.id, deleted: true })),
    ...wanted.filter((p) => !current.some((c) => c.price === p)).map((p) => ({ price: p })),
  ];
  if (changes.length) {
    await getStripe().subscriptions.update(sub.id, {
      items: changes,
      proration_behavior: 'none',
      description: `StoryVenue — ${desired.planName ?? 'subscription'} (monthly)`,
      metadata: { storyvenue_venue_id: v.id, sv_kind: SAAS_KIND, plan_id: desired.planId ?? '' },
    });
  }
  return { totalCents: desired.totalCents, canceled: false };
}

export type StripeChangePlanResult =
  | { kind: 'switched'; plan_id: string }
  | { kind: 'checkout_required'; url: string; plan_id: string };

/**
 * Stripe version of changeVenuePlan (venue-billing.ts) — same branches:
 * $0 total → cancel; subscription on file → update items at next renewal;
 * unused trial → grant it; otherwise → hosted checkout.
 */
export async function changeVenuePlanStripe(venueId: string, targetPlanId: string): Promise<StripeChangePlanResult> {
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  if (v.directory_plan_id === targetPlanId) return { kind: 'switched', plan_id: targetPlanId };

  const { listDirectoryPlanCatalog } = await import('@/lib/venue-billing');
  const { readPlanTrialConfig, planHasTrial, computeTrialEnd } = await import('@/lib/directory-trial');
  const allPlans = await listDirectoryPlanCatalog();
  const target = allPlans.find((p) => p.id === targetPlanId);
  if (!target) throw new Error('Plan not found');
  if ((target.price_monthly_cents ?? 0) > 0 && (await planChangesLocked(venueId))) {
    throw new Error(PLAN_CHANGES_LOCKED_MESSAGE);
  }

  const status = String(v.directory_subscription_status ?? '');
  const hasSub = Boolean(v.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(status));
  const previousPlanId = v.directory_plan_id;
  const desired = await desiredItemsFor(v, target.id);

  if (desired.totalCents <= 0) {
    if (hasSub && v.stripe_subscription_id) await cancelSubQuietly(v.stripe_subscription_id);
    await updateVenue(venueId, {
      directory_plan_id: target.id,
      directory_subscription_status: 'none',
      directory_subscription_external_id: null,
      stripe_subscription_id: null,
    });
    await recordStripeBillingEvent({
      venueId, planId: target.id, amountCents: 0, eventType: 'plan_change',
      externalEventId: `plan_change:${target.id}:${venueId}:${Date.now()}`,
      metadata: { previous_plan_id: previousPlanId, new_plan_id: target.id, subscription_canceled: hasSub },
    });
    scheduleOwnerGhlSync(venueId);
    return { kind: 'switched', plan_id: target.id };
  }

  if (hasSub) {
    await updateVenue(venueId, { directory_plan_id: target.id });
    try {
      await syncSubscriptionItems(venueId);
    } catch (e) {
      await updateVenue(venueId, { directory_plan_id: previousPlanId });
      throw new Error(`Could not change plan in Stripe: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
    await recordStripeBillingEvent({
      venueId, planId: target.id, amountCents: 0, eventType: 'plan_change_next_renewal',
      externalEventId: `plan_change:${target.id}:${venueId}:${Date.now()}`,
      metadata: { previous_plan_id: previousPlanId, new_plan_id: target.id, new_amount_cents: desired.totalCents },
    });
    scheduleOwnerGhlSync(venueId);
    return { kind: 'switched', plan_id: target.id };
  }

  // No subscription: grant an unused trial (no card yet), exactly as before.
  const trialConfig = readPlanTrialConfig(target as unknown as Record<string, unknown>);
  const trialEndsAt = v.directory_trial_ends_at ? new Date(v.directory_trial_ends_at) : null;
  const trialActive = trialEndsAt !== null && trialEndsAt.getTime() > Date.now();
  if (!v.directory_trial_consumed && planHasTrial(trialConfig)) {
    const t = computeTrialEnd(trialConfig, new Date());
    await updateVenue(venueId, {
      directory_plan_id: target.id,
      directory_subscription_status: 'trialing',
      directory_subscription_external_id: null,
      directory_trial_started_at: new Date().toISOString(),
      directory_trial_ends_at: t.endsAt ? t.endsAt.toISOString() : null,
      directory_trial_is_forever: t.forever,
      directory_trial_plan_id: target.id,
      directory_trial_consumed: true,
    });
    return { kind: 'switched', plan_id: target.id };
  }
  if (trialActive && status === 'trialing') {
    await updateVenue(venueId, { directory_plan_id: target.id });
    return { kind: 'switched', plan_id: target.id };
  }

  const { url } = await createSubscriptionCheckout(venueId, { purpose: 'change_plan', planIdOverride: target.id });
  await updateVenue(venueId, { directory_plan_id: target.id, directory_subscription_status: 'pending' });
  return { kind: 'checkout_required', url, plan_id: target.id };
}

export async function cancelVenueSubscriptionStripe(venueId: string): Promise<void> {
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  if (v.stripe_subscription_id) await cancelSubQuietly(v.stripe_subscription_id);
  await updateVenue(venueId, {
    directory_subscription_status: 'canceled',
    directory_subscription_external_id: null,
    stripe_subscription_id: null,
  });
  await recordStripeBillingEvent({
    venueId, planId: v.directory_plan_id, amountCents: 0, eventType: 'subscription_cancel',
    externalEventId: `cancel:${venueId}:${Date.now()}`,
    metadata: { subscription_id: v.stripe_subscription_id, reason: 'user_cancelled' },
  });
  scheduleOwnerGhlSync(venueId);
}

/**
 * Cancel / "Switch to Free": the venue keeps its plan until the end of the
 * term it paid for (or its carded trial), then moves to Free and stays on the
 * platform. The subscription is set to end at that moment so it never renews;
 * Stripe's end-of-term webhook applies Free, and the free-downgrades job
 * (lib/trial-sweep.ts) is the backstop. No subscription, or nothing left of
 * the term → Free now.
 */
export async function scheduleDowngradeToFreeStripe(
  venueId: string,
  why: { reason?: string | null; note?: string | null } = {},
): Promise<{ kind: 'scheduled'; downgradeAt: string } | { kind: 'downgraded' }> {
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  const now = Date.now();
  if (v.directory_downgrade_at && new Date(v.directory_downgrade_at).getTime() > now) {
    return { kind: 'scheduled', downgradeAt: v.directory_downgrade_at };
  }

  let endsAt: Date | null = null;
  const sub = v.stripe_subscription_id ? await retrieveSaasSub(v.stripe_subscription_id) : null;
  if (sub && (sub.status === 'active' || sub.status === 'trialing')) {
    // A trialing subscription's current period is the trial.
    const end = sub.status === 'trialing' ? sub.trial_end : sub.items.data[0]?.current_period_end;
    if (end && end * 1000 > now + 60_000) {
      const updated = await getStripe().subscriptions.update(sub.id, { cancel_at_period_end: true });
      endsAt = new Date((updated.cancel_at ?? end) * 1000);
    }
  }

  if (endsAt) {
    await updateVenue(venueId, { directory_downgrade_at: endsAt.toISOString() });
    await recordStripeBillingEvent({
      venueId, planId: v.directory_plan_id, amountCents: 0, eventType: 'subscription_cancel_scheduled',
      externalEventId: `cancel_scheduled:${venueId}:${now}`,
      metadata: { reason: 'user_cancel', downgrade_at: endsAt.toISOString(), subscription_id: sub?.id ?? null, cancel_reason: why.reason ?? null, cancel_note: why.note ?? null },
    });
    scheduleOwnerGhlSync(venueId);
    return { kind: 'scheduled', downgradeAt: endsAt.toISOString() };
  }
  const { applyFreeDowngrade } = await import('@/lib/venue-billing');
  await applyFreeDowngrade(venueId);
  return { kind: 'downgraded' };
}

export const PLAN_CANT_BE_KEPT_MESSAGE =
  'Your plan can’t be restarted from here. It stays on until its end date, and you can choose a plan again anytime after that.';

/**
 * "Keep my plan": undo a pending cancel before its end date. The subscription
 * renews as normal again; a trial with no card simply carries on.
 */
export async function keepPlanStripe(venueId: string): Promise<void> {
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  if (!v.directory_downgrade_at) return;
  if (v.stripe_subscription_id) {
    const sub = await retrieveSaasSub(v.stripe_subscription_id);
    if (!sub) throw new Error(PLAN_CANT_BE_KEPT_MESSAGE);
    if (sub.cancel_at_period_end) await getStripe().subscriptions.update(sub.id, { cancel_at_period_end: false });
    else if (sub.cancel_at) await getStripe().subscriptions.update(sub.id, { cancel_at: '' });
  } else if (v.directory_subscription_status !== 'trialing') {
    // A paid term with no subscription left behind it (e.g. a cancelled LunarPay plan).
    throw new Error(PLAN_CANT_BE_KEPT_MESSAGE);
  }
  await updateVenue(venueId, { directory_downgrade_at: null });
  await recordStripeBillingEvent({
    venueId, planId: v.directory_plan_id, amountCents: 0, eventType: 'subscription_resumed',
    externalEventId: `resumed:${venueId}:${Date.now()}`,
    metadata: { reason: 'user_kept_plan', canceled_downgrade_at: v.directory_downgrade_at, subscription_id: v.stripe_subscription_id },
  });
  scheduleOwnerGhlSync(venueId);
}

export async function extendTrialStripe(venueId: string, newTrialEndsAt: Date): Promise<{ trialEndsAt: string; newSubId: string | null }> {
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  if (v.stripe_subscription_id && v.directory_subscription_status === 'trialing') {
    await getStripe().subscriptions.update(v.stripe_subscription_id, {
      trial_end: toUnix(newTrialEndsAt),
      proration_behavior: 'none',
    });
  }
  await updateVenue(venueId, {
    directory_trial_ends_at: newTrialEndsAt.toISOString(),
    directory_trial_consumed: false,
    directory_trial_reminder_sent_at: null,
  });
  await recordStripeBillingEvent({
    venueId, planId: v.directory_plan_id, amountCents: 0, eventType: 'trial_extended',
    externalEventId: `trial_ext:${venueId}:${Date.now()}`,
    metadata: { new_trial_ends_at: newTrialEndsAt.toISOString(), subscription_id: v.stripe_subscription_id },
  });
  return { trialEndsAt: newTrialEndsAt.toISOString(), newSubId: v.stripe_subscription_id };
}

/** Pay the subscription's open invoices with its card. Throws if the card declines. */
export async function payOpenInvoices(subId: string): Promise<number> {
  const stripe = getStripe();
  const open = await stripe.invoices.list({ subscription: subId, status: 'open', limit: 10 });
  let paid = 0;
  for (const inv of open.data.sort((a, b) => a.created - b.created)) {
    if (!inv.id) continue;
    const res = await stripe.invoices.pay(inv.id);
    if (res.status === 'paid') paid += 1;
  }
  return paid;
}

/** Past-due wall "Retry": pays the SAME outstanding invoice — never a new charge. */
export async function retryPaymentStripe(venueId: string): Promise<void> {
  const v = await loadBillingVenue(venueId);
  if (!v?.stripe_subscription_id) throw new Error('No active subscription found.');
  try {
    await payOpenInvoices(v.stripe_subscription_id);
  } catch {
    throw new Error('Your card was declined. Please update your payment method and try again.');
  }
  const sub = await retrieveSaasSub(v.stripe_subscription_id);
  if (sub && venueStatusFor(sub) === 'active') {
    await updateVenue(venueId, { directory_subscription_status: 'active', directory_downgrade_at: null });
    scheduleOwnerGhlSync(venueId);
  }
}

// ── Read side (billing page) ─────────────────────────────────────────────────

export interface StripeBillingSnapshot {
  subscription: {
    id: string;
    status: string;
    amount_cents: number;
    frequency: string;
    next_payment_on: string | null;
    started_on: string | null;
  } | null;
  /** Plan and add-on changes are locked (a plan-only price from the LunarPay move). */
  plan_changes_locked: boolean;
  payment_method: {
    id: string;
    last4: string | null;
    brand: string | null;
    name_holder: string | null;
    is_default: boolean;
    exp_month: string | null;
    exp_year: string | null;
  } | null;
}

export async function loadStripeBillingSnapshot(v: Pick<BillingVenue, 'stripe_subscription_id' | 'stripe_customer_id'>): Promise<StripeBillingSnapshot> {
  const stripe = getStripe();
  let subscription: StripeBillingSnapshot['subscription'] = null;
  let pmId: string | null = null;
  let plan_changes_locked = false;
  if (v.stripe_subscription_id) {
    try {
      const sub = await stripe.subscriptions.retrieve(v.stripe_subscription_id);
      plan_changes_locked = subscriptionPlanChangesLocked(sub);
      const amount = sub.items.data.reduce((s, it) => s + (it.price.unit_amount ?? 0) * (it.quantity ?? 1), 0);
      const periodEnd = sub.items.data[0]?.current_period_end ?? null;
      const nextTs = sub.status === 'trialing' ? sub.trial_end : periodEnd;
      subscription = {
        id: sub.id,
        status: sub.status,
        amount_cents: amount,
        frequency: 'monthly',
        next_payment_on: nextTs ? new Date(nextTs * 1000).toISOString() : null,
        started_on: sub.start_date ? new Date(sub.start_date * 1000).toISOString() : null,
      };
      pmId = typeof sub.default_payment_method === 'string' ? sub.default_payment_method : sub.default_payment_method?.id ?? null;
    } catch { /* show without it */ }
  }
  if (!pmId && v.stripe_customer_id) {
    try {
      const cust = await stripe.customers.retrieve(v.stripe_customer_id);
      const d = (cust as Stripe.Customer).invoice_settings?.default_payment_method;
      pmId = typeof d === 'string' ? d : d?.id ?? null;
    } catch { /* ignore */ }
  }
  let payment_method: StripeBillingSnapshot['payment_method'] = null;
  if (pmId) {
    try {
      const pm = await stripe.paymentMethods.retrieve(pmId);
      payment_method = {
        id: pm.id,
        last4: pm.card?.last4 ?? null,
        brand: pm.card?.brand ?? null,
        name_holder: pm.billing_details?.name ?? null,
        is_default: true,
        exp_month: pm.card?.exp_month != null ? String(pm.card.exp_month) : null,
        exp_year: pm.card?.exp_year != null ? String(pm.card.exp_year) : null,
      };
    } catch { /* ignore */ }
  }
  return { subscription, plan_changes_locked, payment_method };
}
