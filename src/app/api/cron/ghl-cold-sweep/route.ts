/**
 * Cron entry point for the low-frequency GHL cold sweep.
 *
 * Polls DORMANT SMS threads (last activity between GHL_COLD_SWEEP_MIN_DAYS and
 * GHL_COLD_SWEEP_MAX_DAYS ago) for GHL-connected venues — the tier below the
 * hot (60 min) and baseline (~14 day) inbound syncs. Without it, a fresh bride
 * reply on a long-quiet thread only surfaces when a human next opens the thread.
 * Reuses the same ingest/dedupe/notification-gate path as every other tier
 * (syncInboundSmsFromGhlForThread → insertInboundGhlSms), so discovered messages
 * are inserted once and alerted only when genuinely fresh.
 *
 * Primary trigger is the in-app scheduler (src/lib/in-app-scheduler.ts, every
 * 15 min). This route is a redundant GitHub Actions backup — the sweep is
 * idempotent (dedupe by ghl_message_id) and watermark-bounded, so overlap is
 * harmless. Reuses MARKETING_CRON_SECRET / CRON_SECRET for auth like the other
 * cron routes.
 *
 * Example invocation:
 *   curl -H "Authorization: Bearer $MARKETING_CRON_SECRET" \
 *     https://app.storyvenue.com/api/cron/ghl-cold-sweep
 *
 * Query params (all optional — override the GHL_COLD_SWEEP_* env defaults):
 *   max        — per-run thread budget (default 40, cap 500)
 *   perVenue   — per-venue cap within a run (default 10)
 *   minDays    — lower bound of "cold" in days (default 14)
 *   maxDays    — upper bound of "cold" in days (default 90)
 *   revisit    — minutes before a swept thread is eligible again (default 30)
 */

import { NextRequest, NextResponse } from 'next/server';
import { runGhlColdThreadSyncSafe } from '@/lib/ghl-inbound-sync-cron';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** A sweep can spend a while paging GHL conversations for the budgeted threads. */
export const maxDuration = 300;

function cronSecret(): string {
  return process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
}

function authorize(request: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return process.env.NODE_ENV !== 'production';
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token === secret) return true;
  const q = request.nextUrl.searchParams.get('secret');
  return !!q && q === secret;
}

function intParam(request: NextRequest, name: string): number | undefined {
  const raw = request.nextUrl.searchParams.get(name);
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runGhlColdThreadSyncSafe({
      maxThreads: intParam(request, 'max'),
      maxPerVenue: intParam(request, 'perVenue'),
      minDays: intParam(request, 'minDays'),
      maxDays: intParam(request, 'maxDays'),
      revisitMinutes: intParam(request, 'revisit'),
    });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.error('[cron ghl-cold-sweep] failed:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest)  { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
