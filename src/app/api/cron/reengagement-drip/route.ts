/**
 * GET /api/cron/reengagement-drip
 *
 * Daily cron that fires the next re-engagement email in the drip sequence for
 * every dormant venue whose next_send_at is in the past.
 *
 * Schedule on Railway: once per day at 10:00 AM UTC.
 * Auth: Bearer CRON_SECRET (or MARKETING_CRON_SECRET).
 */

import { NextRequest, NextResponse } from 'next/server';
import { runReengagementDripCron } from '@/lib/reengagement-drip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cronSecret(): string {
  return process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
}

function authorize(req: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return process.env.NODE_ENV !== 'production';
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token === secret) return true;
  return req.nextUrl.searchParams.get('secret') === secret;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runReengagementDripCron();

  console.log('[reengagement-drip cron]', result);

  return NextResponse.json({
    ok: true,
    ...result,
    timestamp: new Date().toISOString(),
  });
}
