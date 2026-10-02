/**
 * GET /api/cron/send-booking-reports
 *
 * Emails each venue's scheduled Bride Booking System™ report when it comes
 * due (lib/booking-report-cron.ts). Needs the timed-job secret. Nothing
 * schedules it yet, so scheduled reports don't go out until something does.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runBookingReports } from '@/lib/booking-report-cron';
import { secureCompare } from '@/lib/secure-compare';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

function authorized(req: NextRequest): boolean {
  const secret = process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
  if (!secret) return process.env.NODE_ENV !== 'production';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const qs = req.nextUrl.searchParams.get('secret') ?? '';
  return (!!bearer && secureCompare(bearer, secret)) || (!!qs && secureCompare(qs, secret));
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runBookingReports()) });
  } catch (e) {
    console.error('[booking-report cron]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Booking reports failed' }, { status: 500 });
  }
}
