/**
 * Venue payments on Stripe Connect. SERVER-ONLY.
 *
 * Each venue connects its own Stripe account (Accounts v2): the full Stripe
 * Dashboard, Stripe collects its processing fees from the venue and carries
 * losses, and Stripe hosts the signup. Couples pay the venue directly (direct
 * charges on the venue's account); StoryVenue's cut is an application fee from
 * the tier schedule in `platform_payment_fee_tiers`.
 *
 * Rollout, with no code changes:
 *   STRIPE_CONNECT_MODE       off | allowlist | on   (default off)
 *   STRIPE_CONNECT_ALLOWLIST  venue slugs, ids or owner emails (default demo-venue)
 * A venue whose Stripe account can take payments (payments_provider = 'stripe')
 * always uses it; an approved LunarPay merchant stays on LunarPay until then.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
const APP_HOST = new URL(APP_URL).hostname;

// ── Venue row ────────────────────────────────────────────────────────────────

export interface ConnectVenue {
  id: string;
  slug: string | null;
  name: string | null;
  email: string | null;
  notification_email: string | null;
  brand_website: string | null;
  directory_plan_id: string | null;
  onboarding_status: string | null;
  lunarpay_secret_key: string | null;
  accept_ach: boolean | null;
  stripe_account_id: string | null;
  stripe_account_status: string | null;
  stripe_charges_enabled: boolean | null;
  payments_provider: string | null;
  payment_fee_card_percent: number | string | null;
  payment_fee_bank_percent: number | string | null;
}

const VENUE_COLUMNS =
  'id, slug, name, email, notification_email, brand_website, directory_plan_id, onboarding_status, ' +
  'lunarpay_secret_key, accept_ach, stripe_account_id, stripe_account_status, stripe_charges_enabled, ' +
  'payments_provider, payment_fee_card_percent, payment_fee_bank_percent';

export async function loadConnectVenue(venueId: string): Promise<ConnectVenue | null> {
  const { data, error } = await supabaseAdmin.from('venues').select(VENUE_COLUMNS).eq('id', venueId).maybeSingle();
  if (error) throw new Error(`Could not load venue: ${error.message}`);
  return (data as unknown as ConnectVenue | null) ?? null;
}

// ── Rollout ──────────────────────────────────────────────────────────────────

function connectMode(): 'off' | 'allowlist' | 'on' {
  const raw = (process.env.STRIPE_CONNECT_MODE ?? 'off').trim().toLowerCase();
  return raw === 'on' || raw === 'allowlist' ? raw : 'off';
}

function connectAllowlist(): string[] {
  return (process.env.STRIPE_CONNECT_ALLOWLIST ?? 'demo-venue')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** May this venue connect a Stripe account (and see the Stripe setup UI)? */
export function stripeConnectAvailableFor(v: Pick<ConnectVenue, 'id' | 'slug' | 'email' | 'notification_email' | 'stripe_account_id'>): boolean {
  if (!isStripeConfigured()) return false;
  if (v.stripe_account_id) return true; // already started: keep showing it
  const mode = connectMode();
  if (mode === 'on') return true;
  if (mode !== 'allowlist') return false;
  const list = connectAllowlist();
  return [v.slug, v.id, v.email, v.notification_email].some((k) => Boolean(k) && list.includes(String(k).trim().toLowerCase()));
}

/** Couples pay this venue through its Stripe account. */
export function venueTakesStripePayments(v: Pick<ConnectVenue, 'payments_provider' | 'stripe_account_id' | 'stripe_charges_enabled'>): boolean {
  return v.payments_provider === 'stripe' && Boolean(v.stripe_account_id) && v.stripe_charges_enabled === true;
}

/** An approved LunarPay merchant (the old processor). */
export function lunarPayMerchantActive(v: Pick<ConnectVenue, 'onboarding_status' | 'lunarpay_secret_key'>): boolean {
  return v.onboarding_status === 'active' && Boolean(v.lunarpay_secret_key);
}

// ── Account + onboarding ─────────────────────────────────────────────────────

/** The venue's connected account, created on first use (idempotent per venue). */
export async function ensureConnectedAccount(v: ConnectVenue): Promise<string> {
  if (v.stripe_account_id) return v.stripe_account_id;
  const website = (v.brand_website ?? '').trim();
  const account = await getStripe().v2.core.accounts.create(
    {
      contact_email: v.email || undefined,
      display_name: v.name || undefined,
      dashboard: 'full',
      identity: { country: 'us' },
      defaults: {
        currency: 'usd',
        responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
        profile: {
          ...(v.name ? { doing_business_as: v.name } : {}),
          ...(/^https?:\/\//i.test(website) ? { business_url: website } : {}),
          product_description: 'Wedding and event venue: venue rental, packages and event services, invoiced to couples through StoryVenue.',
        },
      },
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { requested: true },
            ach_debit_payments: { requested: true },
          },
        },
      },
      metadata: { storyvenue_venue_id: v.id },
    },
    { idempotencyKey: `sv-connect-account-${v.id}` },
  );
  const { error } = await supabaseAdmin
    .from('venues')
    .update({ stripe_account_id: account.id, stripe_account_status: 'onboarding', stripe_account_synced_at: new Date().toISOString() })
    .eq('id', v.id);
  if (error) throw new Error(`Could not save the Stripe account on the venue: ${error.message}`);
  v.stripe_account_id = account.id;
  return account.id;
}

/** A single-use link to Stripe's hosted signup (or to finish it). Never email it. */
export async function createOnboardingLink(venueId: string): Promise<string> {
  const v = await loadConnectVenue(venueId);
  if (!v) throw new Error('Venue not found');
  if (!stripeConnectAvailableFor(v)) throw new Error('Stripe payments are not available for this venue yet.');
  const account = await ensureConnectedAccount(v);
  const link = await getStripe().v2.core.accountLinks.create({
    account,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant'],
        refresh_url: `${APP_URL}/api/payments/stripe/connect/refresh`,
        return_url: `${APP_URL}/api/payments/stripe/connect/return`,
      },
    },
  });
  return link.url;
}

export type ConnectStatus = 'none' | 'onboarding' | 'pending' | 'active';

export interface ConnectState {
  available: boolean;
  status: ConnectStatus;
  chargesEnabled: boolean;
  accountId: string | null;
  /** Stripe still needs something from the venue (finish or update signup). */
  actionRequired: boolean;
}

/**
 * Read the account from Stripe and store what the app needs. The first time it
 * can take card payments, the venue switches to Stripe for couple payments.
 */
export async function syncConnectedAccount(venueId: string): Promise<ConnectState> {
  const v = await loadConnectVenue(venueId);
  if (!v) throw new Error('Venue not found');
  const available = stripeConnectAvailableFor(v);
  if (!v.stripe_account_id) {
    return { available, status: 'none', chargesEnabled: false, accountId: null, actionRequired: false };
  }
  const account = await getStripe().v2.core.accounts.retrieve(v.stripe_account_id, {
    include: ['configuration.merchant', 'requirements'],
  });
  const cardStatus = account.configuration?.merchant?.capabilities?.card_payments?.status ?? null;
  const entries = account.requirements?.entries ?? [];
  const actionRequired = entries.some(
    (e) => e.awaiting_action_from === 'user' && e.minimum_deadline?.status !== 'eventually_due',
  );
  const chargesEnabled = cardStatus === 'active';
  const status: ConnectStatus = chargesEnabled ? 'active' : actionRequired ? 'onboarding' : 'pending';

  const patch: Record<string, unknown> = {
    stripe_account_status: status,
    stripe_charges_enabled: chargesEnabled,
    stripe_account_synced_at: new Date().toISOString(),
  };
  const switching = chargesEnabled && v.payments_provider !== 'stripe';
  if (switching) patch.payments_provider = 'stripe';
  await supabaseAdmin.from('venues').update(patch).eq('id', v.id);

  if (switching) {
    // Apple Pay / Google Pay on the couple's payment page (best-effort).
    await getStripe()
      .paymentMethodDomains.create({ domain_name: APP_HOST, enabled: true }, { stripeAccount: v.stripe_account_id })
      .catch(() => {});
  }
  return { available, status, chargesEnabled, accountId: v.stripe_account_id, actionRequired };
}

// ── StoryVenue's fee on each payment ─────────────────────────────────────────

export type FeeTier = 'paid' | 'free';

interface TierRates {
  card_fee_percent: number;
  bank_total_percent: number;
}

const DEFAULT_TIERS: Record<FeeTier, TierRates> = {
  paid: { card_fee_percent: 0.5, bank_total_percent: 1.0 },
  free: { card_fee_percent: 1.0, bank_total_percent: 1.5 },
};

let tierCache: { at: number; tiers: Record<FeeTier, TierRates> } | null = null;

export async function loadFeeTiers(): Promise<Record<FeeTier, TierRates>> {
  if (tierCache && Date.now() - tierCache.at < 60_000) return tierCache.tiers;
  const tiers: Record<FeeTier, TierRates> = { ...DEFAULT_TIERS };
  const { data } = await supabaseAdmin.from('platform_payment_fee_tiers').select('tier, card_fee_percent, bank_total_percent');
  for (const r of (data ?? []) as Array<{ tier: string; card_fee_percent: number | string; bank_total_percent: number | string }>) {
    if (r.tier === 'paid' || r.tier === 'free') {
      tiers[r.tier] = { card_fee_percent: Number(r.card_fee_percent), bank_total_percent: Number(r.bank_total_percent) };
    }
  }
  tierCache = { at: Date.now(), tiers };
  return tiers;
}

/** Free = the venue is on a $0 (non-legacy) plan. Everyone else pays the paid-plan rates. */
export async function feeTierFor(v: Pick<ConnectVenue, 'directory_plan_id'>): Promise<FeeTier> {
  if (!v.directory_plan_id) return 'paid';
  const { data } = await supabaseAdmin
    .from('directory_plans')
    .select('price_monthly_cents, is_legacy')
    .eq('id', v.directory_plan_id)
    .maybeSingle();
  const plan = data as { price_monthly_cents: number | null; is_legacy: boolean | null } | null;
  if (!plan || plan.is_legacy) return 'paid';
  return (plan.price_monthly_cents ?? 0) > 0 ? 'paid' : 'free';
}

export type PaymentKind = 'card' | 'bank';

/** Stripe's ACH fee on a payment: 0.8%, at most $5. */
export function stripeAchFeeCents(amountCents: number): number {
  return Math.min(Math.round(amountCents * 0.008), 500);
}

/**
 * StoryVenue's application fee on one payment. Stripe deducts its own
 * processing fee from the venue separately (fees_collector = stripe).
 *   card: the tier's card % (any brand)
 *   bank: the tier's all-in bank % minus what Stripe already charges
 */
export async function applicationFeeCents(
  v: Pick<ConnectVenue, 'directory_plan_id' | 'payment_fee_card_percent' | 'payment_fee_bank_percent'>,
  amountCents: number,
  kind: PaymentKind,
): Promise<number> {
  const tiers = await loadFeeTiers();
  const rates = tiers[await feeTierFor(v)];
  const cardPct = v.payment_fee_card_percent != null ? Number(v.payment_fee_card_percent) : rates.card_fee_percent;
  const bankPct = v.payment_fee_bank_percent != null ? Number(v.payment_fee_bank_percent) : rates.bank_total_percent;
  const fee = kind === 'card'
    ? Math.round((amountCents * cardPct) / 100)
    : Math.max(0, Math.round((amountCents * bankPct) / 100) - stripeAchFeeCents(amountCents));
  return Math.max(0, Math.min(fee, amountCents - 1));
}

/** Dashboard link to a connected account from the platform's Stripe dashboard. */
export function connectedAccountDashboardUrl(accountId: string): string {
  return `https://dashboard.stripe.com/connect/accounts/${accountId}`;
}
