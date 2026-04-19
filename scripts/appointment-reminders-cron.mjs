#!/usr/bin/env node
/**
 * Calls GET /api/cron/appointment-reminders with Bearer auth.
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
  console.error('appointment-reminders-cron: set MARKETING_CRON_SECRET or CRON_SECRET');
  process.exit(1);
}
if (!base) {
  console.error(
    'appointment-reminders-cron: set MARKETING_CRON_BASE_URL or NEXT_PUBLIC_APP_URL, or RAILWAY_PUBLIC_DOMAIN',
  );
  process.exit(1);
}

const origin = base.replace(/\/$/, '');
const url = `${origin}/api/cron/appointment-reminders`;

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${secret}` },
});

const body = await res.text();
if (!res.ok) {
  console.error(`appointment-reminders-cron: HTTP ${res.status}`, body);
  process.exit(1);
}
console.log(body);
