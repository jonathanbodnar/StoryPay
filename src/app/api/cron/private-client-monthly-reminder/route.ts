/**
 * GET /api/cron/private-client-monthly-reminder
 *
 * Pinged daily at 17:00 UTC (= 12:00 PM Eastern Standard Time). Sends the
 * monthly pipeline-update reminder to every Private Client venue
 * (is_private_client = true) whose private_client_monthly_reminder_next_at is
 * due, then advances it to the 1st of the following month. next_at is always
 * set to the 1st, so the 17:00 UTC ping only actually delivers on the 1st (at
 * 12:00 PM EST); every other day is a no-op guarded by the DB timestamp.
 *
 * Railway / GitHub Actions example:
 *   0 17 * * *  GET /api/cron/private-client-monthly-reminder  (Bearer $CRON_SECRET)
 */

import { NextRequest, NextResponse } from 'next/server';
import { processPrivateClientMonthlyReminder } from '@/lib/private-client-monthly-reminder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: NextRequest): boolean {
  const secret = process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
  // No secret configured: allow in dev, block in production.
  if (!secret) return process.env.NODE_ENV !== 'production';
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim();
  const qs = req.nextUrl.searchParams.get('secret') ?? '';
  return bearer === secret || qs === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const summary = await processPrivateClientMonthlyReminder();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error('[private-client-monthly-reminder cron]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Reminder run failed' }, { status: 500 });
  }
}
