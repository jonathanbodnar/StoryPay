#!/usr/bin/env node
/**
 * Calls GET /api/cron/reengagement-drip with Bearer auth.
 *
 * Fires the next re-engagement email in the drip sequence for every dormant
 * venue whose next_send_at is in the past. Intended to run once per day.
 *
 * Env (required):
 *   MARKETING_CRON_SECRET or CRON_SECRET
 * Base URL:
 *   MARKETING_CRON_BASE_URL, NEXT_PUBLIC_APP_URL, or RAILWAY_PUBLIC_DOMAIN
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
  console.error('reengagement-drip-cron: set MARKETING_CRON_SECRET or CRON_SECRET');
  process.exit(1);
}
if (!base) {
  console.error(
    'reengagement-drip-cron: set MARKETING_CRON_BASE_URL or NEXT_PUBLIC_APP_URL, or RAILWAY_PUBLIC_DOMAIN',
  );
  process.exit(1);
}

const origin = base.replace(/\/$/, '');
const url = `${origin}/api/cron/reengagement-drip`;

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${secret}` },
});

const body = await res.text();
if (!res.ok) {
  console.error(`reengagement-drip-cron: HTTP ${res.status}`, body);
  process.exit(1);
}
console.log(body);
