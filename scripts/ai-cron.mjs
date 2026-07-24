#!/usr/bin/env node
/**
 * AI Concierge cron — runs on Railway as a dedicated always-on service.
 *
 * Two jobs:
 *   ai-send     — fires every loop iteration (~60s sleep). Picks up any leads
 *                 whose ai_next_send_at has passed and dispatches the next AI
 *                 SMS via GHL. The route itself is idempotent so running it
 *                 every minute is safe and keeps latency under 2 minutes.
 *
 *   ai-activate — fires once per hour (keyed off wall-clock hour). Flips
 *                 dormant leads to ai_active after the 24-hour re-enable
 *                 cooldown. Much lower frequency is fine; hourly is generous.
 *
 * Env (required):
 *   MARKETING_CRON_SECRET or CRON_SECRET
 * Base URL (one of):
 *   MARKETING_CRON_BASE_URL, NEXT_PUBLIC_APP_URL, or RAILWAY_PUBLIC_DOMAIN
 *
 * To deploy on Railway:
 *   1. Create a new service in your project (name it "AI Concierge Cron").
 *   2. Point it at this repo (same repo as StoryVenue Dash).
 *   3. Set Start Command: node scripts/ai-cron.mjs
 *   4. Add env vars: MARKETING_CRON_SECRET (same value as Railway app),
 *      MARKETING_CRON_BASE_URL=https://app.storyvenue.com
 *   5. Deploy. The service loops forever; Railway restarts it if it crashes.
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
  console.error('[ai-cron] MARKETING_CRON_SECRET or CRON_SECRET is required');
  process.exit(1);
}
if (!base) {
  console.error('[ai-cron] set MARKETING_CRON_BASE_URL, NEXT_PUBLIC_APP_URL, or RAILWAY_PUBLIC_DOMAIN');
  process.exit(1);
}

const origin = base.replace(/\/$/, '');

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowHour() {
  return new Date().getUTCHours();
}

function ts() {
  return new Date().toISOString();
}

async function hitRoute(path, label) {
  try {
    const res = await fetch(`${origin}${path}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await res.text();
    if (res.ok) {
      console.log(`[${ts()}] [${label}] ok:`, body.slice(0, 200));
    } else {
      console.error(`[${ts()}] [${label}] HTTP ${res.status}:`, body.slice(0, 300));
    }
  } catch (err) {
    console.error(`[${ts()}] [${label}] fetch failed:`, err?.message || err);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

let lastActivateHour = -1;

console.log(`[${ts()}] AI Concierge cron started. Base URL: ${origin}`);

while (true) {
  // 1. ai-send — every iteration (sends any due AI follow-up SMS).
  await hitRoute('/api/cron/ai-send', 'ai-send');

  // 2. ai-activate — once per UTC hour (re-enables dormant leads after cooldown).
  const currentHour = nowHour();
  if (currentHour !== lastActivateHour) {
    await hitRoute('/api/cron/ai-activate', 'ai-activate');
    lastActivateHour = currentHour;
  }

  // Wait 60 seconds before the next send check.
  await sleep(60_000);
}
