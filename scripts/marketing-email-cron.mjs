#!/usr/bin/env node
/**
 * Calls GET /api/cron/marketing-email with Bearer auth (same as scripts/marketing-email-cron.sh).
 *
 * Env (required):
 *   MARKETING_CRON_SECRET or CRON_SECRET
 * One of (base URL, no path):
 *   MARKETING_CRON_BASE_URL, NEXT_PUBLIC_APP_URL, or RAILWAY_PUBLIC_DOMAIN (https added automatically)
 */

const secret = process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
let base =
  process.env.MARKETING_CRON_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  '';
if (!base && process.env.RAILWAY_PUBLIC_DOMAIN) {
  base = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}

if (!secret) {
  console.error(
    'marketing-email-cron: set MARKETING_CRON_SECRET or CRON_SECRET',
  );
  process.exit(1);
}
if (!base) {
  console.error(
    'marketing-email-cron: set MARKETING_CRON_BASE_URL or NEXT_PUBLIC_APP_URL, or run on Railway with RAILWAY_PUBLIC_DOMAIN',
  );
  process.exit(1);
}

const origin = base.replace(/\/$/, '');
const url = `${origin}/api/cron/marketing-email`;

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${secret}` },
});

const body = await res.text();
if (!res.ok) {
  console.error(`marketing-email-cron: HTTP ${res.status}`, body);
  process.exit(1);
}
console.log(body);
