#!/usr/bin/env node
/**
 * One-time Stripe setup for StoryVenue SaaS billing.
 *
 *   node scripts/stripe-setup.mjs --url https://app.storyvenue.com/api/webhooks/stripe \
 *        [--railway-service "StoryVenue Backend"]
 *
 * Creates the webhook endpoint for the events lib/stripe/webhooks.ts handles.
 * With --railway-service, the endpoint's signing secret is written straight to
 * that Railway service as STRIPE_WEBHOOK_SECRET (never printed). Without it,
 * the secret is printed once for you to add yourself.
 *
 * Uses STRIPE_SECRET_KEY from the environment or .env.local (test or live key —
 * the endpoint is created in that mode). Re-running with the same URL reuses
 * the existing endpoint (Stripe only reveals a secret at creation; use
 * --recreate to replace it and get a new secret).
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
    const m = readFileSync(join(root, '.env.local'), 'utf8').match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'));
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
const key = envKey('STRIPE_SECRET_KEY');
if (!key) {
  console.error('STRIPE_SECRET_KEY not found in the environment or .env.local');
  process.exit(1);
}

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
const mode = key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'LIVE' : 'TEST';

const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter((e) => e.url === url);
if (existing.length && !recreate) {
  const ep = existing[0];
  await stripe.webhookEndpoints.update(ep.id, { enabled_events: EVENTS, disabled: false });
  console.log(`[${mode}] Endpoint already exists (${ep.id}); events updated. Its secret was shown when it was created.`);
  console.log('Run again with --recreate to replace it and get a new secret.');
  process.exit(0);
}
for (const ep of existing) await stripe.webhookEndpoints.del(ep.id);

const ep = await stripe.webhookEndpoints.create({
  url,
  enabled_events: EVENTS,
  description: 'StoryVenue SaaS billing (lib/stripe/webhooks.ts)',
});
console.log(`[${mode}] Created webhook endpoint ${ep.id} → ${url}`);

if (railwayService) {
  execFileSync('railway', ['variables', '--service', railwayService, '--set', `STRIPE_WEBHOOK_SECRET=${ep.secret}`], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log(`Saved STRIPE_WEBHOOK_SECRET on Railway service "${railwayService}" (not printed).`);
} else {
  console.log(`STRIPE_WEBHOOK_SECRET=${ep.secret}`);
  console.log('Add that to your server environment. It is not shown again.');
}
