/**
 * Stripe for StoryVenue's own SaaS billing (venues paying for the software),
 * on the owner's existing Stripe account. SERVER-ONLY.
 *
 * Rollout is controlled without code changes:
 *   STRIPE_BILLING_MODE  off | allowlist | on   (default off)
 *   STRIPE_BILLING_SLUGS comma-separated venue slugs for `allowlist`
 *                         (default: demo-venue)
 * A venue already billed on Stripe (`billing_provider = 'stripe'`) always stays
 * on Stripe regardless of the mode, and a venue still on LunarPay stays there
 * until it's moved.
 */

import Stripe from 'stripe';

let client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

/** The shared server SDK. Throws when the key is missing, so callers fail closed. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY is missing).');
  client ??= new Stripe(key, { appInfo: { name: 'StoryVenue' }, maxNetworkRetries: 2 });
  return client;
}

/**
 * Handed to the browser by the server (payment-intent route), so a plain
 * runtime variable works and a key change needs no rebuild.
 */
export function stripePublishableKey(): string | null {
  return (
    process.env.STRIPE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    null
  );
}

type Mode = 'off' | 'allowlist' | 'on';

function billingMode(): Mode {
  const raw = (process.env.STRIPE_BILLING_MODE ?? 'off').trim().toLowerCase();
  return raw === 'on' || raw === 'allowlist' ? raw : 'off';
}

function allowlist(): string[] {
  return (process.env.STRIPE_BILLING_SLUGS ?? 'demo-venue')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Should a venue with no billing provider yet start billing on Stripe? */
export function stripeBillingEnabledFor(slug: string | null | undefined): boolean {
  if (!isStripeConfigured()) return false;
  const mode = billingMode();
  if (mode === 'on') return true;
  if (mode === 'allowlist') return Boolean(slug) && allowlist().includes(String(slug).toLowerCase());
  return false;
}

/** Stripe dashboard link for an object id (customer or subscription), live or test. */
export function stripeDashboardUrl(path: string): string {
  const test = (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_test_') ||
    (process.env.STRIPE_SECRET_KEY ?? '').startsWith('rk_test_');
  return `https://dashboard.stripe.com${test ? '/test' : ''}/${path.replace(/^\/+/, '')}`;
}
