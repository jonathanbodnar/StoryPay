#!/usr/bin/env node
/**
 * Configure the test copy (Railway environment "Dev", service "StoryVenue
 * Backend") from the values the owner pasted there as STAGING_* plus a short,
 * fixed list copied from production. Everything else is left out on purpose:
 * no texting/CRM, LunarPay, push, Slack, Meta pixel or live Stripe settings.
 *
 * Values are never printed: each one goes to Railway through stdin. Changes
 * are staged with --skip-deploys; nothing deploys until --deploy.
 *
 *   node scripts/staging/configure-railway.mjs            # dry run: show what would be set
 *   node scripts/staging/configure-railway.mjs --apply    # set the variables
 *   node scripts/staging/configure-railway.mjs --apply --deploy
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// owner/repo from the git remote, so this keeps working when the repo moves.
const REPO = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
  .replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');

const SERVICE = 'StoryVenue Backend';
const ENV = 'Dev';
const LIVE_SUPABASE_REF = 'brnxhsaakmhgwcthcapd';
const apply = process.argv.includes('--apply');
const deploy = process.argv.includes('--deploy');

const railwayEnv = { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.5' };
function vars(environment) {
  const out = execFileSync('railway', ['variables', '--service', SERVICE, '--environment', environment, '--json'], { env: railwayEnv, encoding: 'utf8' });
  return JSON.parse(out);
}

const live = vars('production');
const dev = vars(ENV);

// 1. What the owner pasted (STAGING_*), checked before anything is written.
const need = ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY', 'STAGING_SUPABASE_DB_URL'];
const missing = need.filter((k) => !dev[k]?.trim());
if (missing.length) {
  console.error(`Missing in the Dev environment: ${missing.join(', ')}`);
  process.exit(1);
}
for (const k of need) {
  if (dev[k].includes(LIVE_SUPABASE_REF)) {
    console.error(`${k} points at the live database. Stopping.`);
    process.exit(1);
  }
}
for (const k of ['STAGING_STRIPE_SECRET_KEY', 'STAGING_STRIPE_PUBLISHABLE_KEY']) {
  if (dev[k] && !/^(sk|pk)_test_/.test(dev[k].trim())) {
    console.error(`${k} is not a Stripe test key. Stopping.`);
    process.exit(1);
  }
}

// 2. The test copy's settings.
const secret = () => randomBytes(32).toString('base64url');
const keepOrNew = (k) => dev[k]?.trim() || secret(); // stable across reruns
const set = {
  APP_ENV: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: dev.STAGING_SUPABASE_URL.trim(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: dev.STAGING_SUPABASE_ANON_KEY.trim(),
  SUPABASE_SERVICE_ROLE_KEY: dev.STAGING_SUPABASE_SERVICE_ROLE_KEY.trim(),
  SUPABASE_DB_URL: dev.STAGING_SUPABASE_DB_URL.trim(),
  DATABASE_URL: dev.STAGING_SUPABASE_DB_URL.trim(),
  // Email: only the platform admin's own address may receive mail.
  STAGING_EMAIL_ALLOWLIST: dev.STAGING_EMAIL_ALLOWLIST?.trim() || (live.ADMIN_EMAIL ?? '').trim(),
  STAGING_PASSWORD: dev.STAGING_PASSWORD?.trim() || randomBytes(15).toString('base64url'),
  ADMIN_PASSWORD: keepOrNew('ADMIN_PASSWORD'),
};
for (const k of ['SESSION_SECRET', 'ADMIN_SECRET', 'MARKETING_CRON_SECRET', 'CRON_SECRET', 'MARKETING_EMAIL_TOKEN_SECRET',
  'CONVERSATIONS_INBOUND_SECRET', 'TOKEN_ENCRYPTION_KEY', 'LEAD_WEBHOOK_SECRET', 'INBOUND_EMAIL_WEBHOOK_TOKEN', 'MCP_API_KEY']) {
  set[k] = keepOrNew(k);
}
if (dev.STAGING_STRIPE_SECRET_KEY) set.STRIPE_SECRET_KEY = dev.STAGING_STRIPE_SECRET_KEY.trim();
if (dev.STAGING_STRIPE_PUBLISHABLE_KEY) set.STRIPE_PUBLISHABLE_KEY = dev.STAGING_STRIPE_PUBLISHABLE_KEY.trim();

// Copied from production as is: email sending, AI, maps, links, feature modes.
const COPY = ['ADMIN_EMAIL', 'RESEND_API_KEY', 'RESEND_DEFAULT_FROM', 'RESEND_VERIFIED_DOMAINS', 'RESEND_COUPLE_INVITE_FROM',
  'SUPPORT_FROM_EMAIL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'GOOGLE_PLACES_API_KEY',
  'NEXT_PUBLIC_MAPBOX_TOKEN', 'NEXT_PUBLIC_DIRECTORY_URL', 'NEXT_PUBLIC_ZAPIER_INVITE_URL', 'LEADFINDER_ENABLED',
  'STRIPE_BILLING_MODE', 'STRIPE_CONNECT_MODE'];
for (const k of COPY) if (live[k]?.trim()) set[k] = live[k].trim();

const appUrl = dev.NEXT_PUBLIC_APP_URL?.trim();
if (appUrl) set.NEXT_PUBLIC_APP_URL = appUrl;

console.log(`Dev settings to ${apply ? 'set' : 'set (dry run)'}: ${Object.keys(set).sort().join(', ')}`);
if (!appUrl) console.log('NEXT_PUBLIC_APP_URL is not set yet: create the Dev domain first, then rerun.');
if (!apply) process.exit(0);

for (const [key, value] of Object.entries(set)) {
  if (dev[key] === value) continue;
  const r = spawnSync('railway', ['variable', 'set', key, '--stdin', '--skip-deploys', '--service', SERVICE, '--environment', ENV], {
    env: railwayEnv, input: value, encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(`Could not set ${key}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    process.exit(1);
  }
}
console.log('Variables set (no deploy yet).');

if (deploy) {
  const r = spawnSync('railway', ['environment', 'edit', '--environment', ENV,
    '--service-config', SERVICE, 'source.repo', REPO,
    '--service-config', SERVICE, 'source.branch', 'main',
    '--service-config', SERVICE, 'build.builder', 'RAILPACK',
    '--message', 'Test copy: deploy StoryVenue Backend from main'], { env: railwayEnv, encoding: 'utf8' });
  console.log(r.status === 0 ? 'Source set to main: Railway deploys the test copy now.' : `Could not set the source: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
}
