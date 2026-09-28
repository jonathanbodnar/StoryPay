#!/usr/bin/env node
/**
 * One-time Stripe setup for StoryVenue SaaS billing.
 *
 *   node scripts/stripe-setup.mjs --url https://app.storyvenue.com/api/webhooks/stripe \
 *        [--railway-service "StoryVenue Backend"] [--recreate]
 *
 * Creates the webhook endpoint for the events lib/stripe/webhooks.ts handles,
 * pinned to the API version the app's Stripe SDK uses (otherwise Stripe sends
 * events in the account's default version, which can be years older).
 *
 * With --railway-service, STRIPE_SECRET_KEY is read from that Railway service
 * when it isn't in the environment or .env.local, and the endpoint's signing
 * secret is written straight back to it as STRIPE_WEBHOOK_SECRET. Neither is
 * printed. Without it, the signing secret is printed once for you to add.
 *
 * The key's mode (test or live) decides where the endpoint is created.
 * Re-running with the same URL reuses the existing endpoint (Stripe only
 * reveals a secret at creation). It's replaced, with a new secret, when you
 * pass --recreate or its API version is out of date.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function envKey(name) {
  if (process.env[name]) return process.env[name].trim();
  try {
    const m = readFileSync(join(root, '.env.local'), 'utf8').match(new RegExp(`^${name}[ \\t]*=[ \\t]*(\\S.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : '';
  } catch {
    return '';
  }
}

const args = process.argv.slice(2);
const arg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const url = arg('--url');
const railwayService = arg('--railway-service');
const recreate = args.includes('--recreate');

if (!url || !/^https:\/\//.test(url)) {
  console.error('Usage: node scripts/stripe-setup.mjs --url https://<app>/api/webhooks/stripe [--railway-service "<name>"] [--recreate]');
  process.exit(1);
}

let railwayVars = null;
if (railwayService) {
  try {
    railwayVars = JSON.parse(
      execFileSync('railway', ['variables', '--service', railwayService, '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      }),
    );
  } catch {
    console.error(`Could not read variables from Railway service "${railwayService}".`);
    process.exit(1);
  }
}

const key = envKey('STRIPE_SECRET_KEY') || (railwayVars?.STRIPE_SECRET_KEY ?? '').trim();
if (!key) {
  console.error('STRIPE_SECRET_KEY not found in the environment, .env.local or the Railway service.');
  process.exit(1);
}
if (!/^(sk|rk)_(test|live)_/.test(key)) {
  console.error('STRIPE_SECRET_KEY does not look like a Stripe secret key (sk_test_…, sk_live_…).');
  process.exit(1);
}
const mode = /^(sk|rk)_live_/.test(key) ? 'LIVE' : 'TEST';

if (railwayVars) {
  const pk = (railwayVars.STRIPE_PUBLISHABLE_KEY ?? railwayVars.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').trim();
  if (!pk) {
    console.warn('Warning: STRIPE_PUBLISHABLE_KEY is not set on Railway yet; the card form needs it.');
  } else if ((mode === 'LIVE') !== pk.startsWith('pk_live_')) {
    console.error(`STRIPE_PUBLISHABLE_KEY on Railway is not a ${mode.toLowerCase()} key but the secret key is. Use a matching pair.`);
    process.exit(1);
  }
}

// Must match STRIPE_WEBHOOK_EVENTS in src/lib/stripe/webhooks.ts.
const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
];

const stripe = new Stripe(key);
const API_VERSION = Stripe.API_VERSION;

const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter((e) => e.url === url);
if (existing.length && !recreate && existing[0].api_version === API_VERSION) {
  const ep = existing[0];
  await stripe.webhookEndpoints.update(ep.id, { enabled_events: EVENTS, disabled: false });
  console.log(`[${mode}] Endpoint already exists (${ep.id}); events updated. Its secret was shown when it was created.`);
  console.log('Run again with --recreate to replace it and get a new secret.');
  process.exit(0);
}
for (const ep of existing) {
  if (!recreate) console.log(`[${mode}] Replacing ${ep.id}: API version ${ep.api_version ?? 'account default'} → ${API_VERSION}`);
  await stripe.webhookEndpoints.del(ep.id);
}

const ep = await stripe.webhookEndpoints.create({
  url,
  enabled_events: EVENTS,
  api_version: API_VERSION,
  description: 'StoryVenue SaaS billing (lib/stripe/webhooks.ts)',
});
console.log(`[${mode}] Created webhook endpoint ${ep.id} → ${url} (API ${API_VERSION})`);

if (railwayService) {
  execFileSync('railway', ['variable', 'set', 'STRIPE_WEBHOOK_SECRET', '--stdin', '--service', railwayService], {
    input: ep.secret,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  console.log(`Saved STRIPE_WEBHOOK_SECRET on Railway service "${railwayService}" (not printed). Railway redeploys to apply it.`);
} else {
  console.log(`STRIPE_WEBHOOK_SECRET=${ep.secret}`);
  console.log('Add that to your server environment. It is not shown again.');
}
