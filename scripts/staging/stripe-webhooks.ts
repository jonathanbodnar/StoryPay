/**
 * Point Stripe's TEST-mode webhooks at the test copy and save their signing
 * secrets in Railway's Dev environment (never printed). Test keys only. The
 * event lists come from the app itself, so they never drift.
 *
 *   railway run --service "StoryVenue Backend" --environment Dev -- npx tsx --tsconfig ./tsconfig.json scripts/staging/stripe-webhooks.ts
 *
 * Reruns replace the two endpoints (Stripe only reveals a secret at creation).
 */

import { spawnSync } from 'node:child_process';
import Stripe from 'stripe';
import { STRIPE_WEBHOOK_EVENTS } from '@/lib/stripe/webhooks';
import { STRIPE_CONNECT_WEBHOOK_EVENTS } from '@/lib/stripe/connect-webhooks';

async function main() {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (process.env.APP_ENV !== 'staging' || !base || /storyvenue\.com/.test(base)) {
    throw new Error('Run this with railway run --environment Dev (the test copy).');
  }
  if (!key.startsWith('sk_test_')) throw new Error('Only a Stripe test-mode secret key (sk_test_) is accepted.');
  const stripe = new Stripe(key);

  const targets = [
    { path: '/api/webhooks/stripe', events: STRIPE_WEBHOOK_EVENTS, connect: false, secretVar: 'STRIPE_WEBHOOK_SECRET', label: 'SaaS billing' },
    { path: '/api/webhooks/stripe-connect', events: STRIPE_CONNECT_WEBHOOK_EVENTS, connect: true, secretVar: 'STRIPE_CONNECT_WEBHOOK_SECRET', label: 'venue payments (Connect)' },
  ] as const;

  const all = (await stripe.webhookEndpoints.list({ limit: 100 })).data;
  for (const t of targets) {
    const url = base + t.path;
    for (const ep of all.filter((e) => e.url === url)) await stripe.webhookEndpoints.del(ep.id);
    const ep = await stripe.webhookEndpoints.create({
      url,
      enabled_events: [...t.events] as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
      api_version: Stripe.API_VERSION as Stripe.WebhookEndpointCreateParams.ApiVersion,
      ...(t.connect ? { connect: true } : {}),
      description: `StoryVenue test copy: ${t.label}`,
    });
    const saved = spawnSync('railway', ['variable', 'set', t.secretVar, '--stdin', '--skip-deploys', '--service', 'StoryVenue Backend', '--environment', 'Dev'], {
      input: ep.secret, encoding: 'utf8', env: { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.5' },
    });
    if (saved.status !== 0) throw new Error(`Could not save ${t.secretVar} to Railway Dev.`);
    console.log(`${t.label}: ${url} (${t.events.length} events), secret saved to Railway Dev as ${t.secretVar}`);
  }

  const others = all.filter((e) => !targets.some((t) => e.url === base + t.path));
  if (others.length) console.log(`Other test-mode endpoints on this Stripe account: ${others.map((e) => e.url).join(', ')}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
