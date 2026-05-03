/**
 * Cron entry point for AI Concierge activation.
 *
 * Schedule: hourly. Reuses MARKETING_CRON_SECRET (or CRON_SECRET) for auth so
 * existing GitHub Actions workflows can invoke it without new env vars.
 *
 * Example invocation:
 *   curl -H "Authorization: Bearer $MARKETING_CRON_SECRET" \
 *     https://app.storyvenue.com/api/cron/ai-activate
 *
 * Returns a JSON summary so the GitHub Actions workflow can surface stats
 * without needing to query the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAiActivationCron } from '@/lib/ai-concierge/activation-cron';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  const maxLeads = maxLeadsParam ? Math.max(1, Math.min(5000, parseInt(maxLeadsParam, 10) || 0)) : undefined;

  try {
    const result = await runAiActivationCron({ maxLeads });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.error('[cron ai-activate] failed:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest)  { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
