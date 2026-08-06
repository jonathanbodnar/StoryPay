/**
 * Cron entry point for the periodic inbound GHL SMS sync.
 *
 * Schedule: every 5 minutes (GitHub Actions — .github/workflows/
 * ghl-inbound-sync-cron.yml). Reuses MARKETING_CRON_SECRET / CRON_SECRET for
 * auth like the other cron routes.
 *
 * Example invocation:
 *   curl -H "Authorization: Bearer $MARKETING_CRON_SECRET" \
 *     https://app.storyvenue.com/api/cron/ghl-inbound-sync
 *
 * Query params (all optional):
 *   max      — max threads scanned per run (default 40, cap 500)
 *   days     — SMS-activity recency window in days (default 14, cap 90)
 *   backfill — max venue_customers missing ghl_contact_id to resolve per run
 *              (default 20, cap 1000). Set high for a one-off full sweep.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runGhlInboundSyncCronSafe } from '@/lib/ghl-inbound-sync-cron';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** A full sweep can spend a while paging GHL conversations. */
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
    const result = await runGhlInboundSyncCronSafe({
      maxThreads: intParam(request, 'max'),
      activeDays: intParam(request, 'days'),
      backfillLimit: intParam(request, 'backfill'),
    });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.error('[cron ghl-inbound-sync] failed:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest)  { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
