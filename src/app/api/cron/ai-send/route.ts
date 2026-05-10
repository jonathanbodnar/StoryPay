/**
 * Cron entry point for AI Concierge SMS sends.
 *
 * Schedule: every ~10 minutes. Reuses MARKETING_CRON_SECRET (or CRON_SECRET)
 * for auth so existing GitHub Actions workflows can invoke it without new
 * env vars.
 *
 * Example invocation:
 *   curl -H "Authorization: Bearer $MARKETING_CRON_SECRET" \
 *     https://app.storyvenue.com/api/cron/ai-send
 *
 * Returns a JSON summary so the GitHub Actions workflow can surface stats
 * without needing to query the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAiSendCron } from '@/lib/ai-concierge/send-cron';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** This cron can spend several seconds per lead waiting on DeepSeek. */
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

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const maxLeadsParam = request.nextUrl.searchParams.get('max');
  const maxLeads = maxLeadsParam
    ? Math.max(1, Math.min(200, parseInt(maxLeadsParam, 10) || 0))
    : undefined;

  const reservParam = request.nextUrl.searchParams.get('reserve');
  const reservationMinutes = reservParam
    ? Math.max(1, Math.min(60, parseInt(reservParam, 10) || 0))
    : undefined;

  try {
    const result = await runAiSendCron({ maxLeads, reservationMinutes });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.error('[cron ai-send] failed:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest)  { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
