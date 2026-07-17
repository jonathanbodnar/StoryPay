/**
 * GET /api/cron/send-booking-reports
 *
 * Runs daily (e.g. 08:00 UTC). Finds every venue whose
 * report_schedule_enabled = true AND report_schedule_next_at <= now(),
 * compiles the 30-day Bride Booking System™ report, emails a short summary
 * with the full PDF attached, then advances next_at by 30 days.
 *
 * Railway cron example:
 *   0 8 * * *  GET /api/cron/send-booking-reports?secret=$CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildBookingReportSummaryHtml } from '@/lib/booking-report-email';
import { buildBookingReportPdf } from '@/lib/booking-report-pdf';
import { compileBookingReport, bookingReportFilename } from '@/lib/booking-report-data';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

function cronSecret(): string {
  return process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
}

function authorized(req: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return true;
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim();
  const qs     = req.nextUrl.searchParams.get('secret') ?? '';
  return bearer === secret || qs === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date().toISOString();
  const { data: venues, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, report_schedule_emails, report_schedule_next_at')
    .eq('report_schedule_enabled', true)
    .lte('report_schedule_next_at', now)
    .not('report_schedule_next_at', 'is', null);

  if (error) {
    console.error('[booking-report cron] query error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type VenueRow = { id: string; name: string; report_schedule_emails: string[]; report_schedule_next_at: string };
  const rows = (venues ?? []) as VenueRow[];

  let sent = 0, failed = 0;

  for (const venue of rows) {
    const emails = (venue.report_schedule_emails ?? []).filter(e => e.includes('@'));
    if (!emails.length) continue;

    try {
      const { reportData } = await compileBookingReport(venue.id);
      const html = buildBookingReportSummaryHtml(reportData);
      const pdf  = await buildBookingReportPdf(reportData);
      const filename = bookingReportFilename(reportData);

      const results = await Promise.all(
        emails.map(to => sendEmail({
          to,
          subject: `Bride Booking System™ Report — ${reportData.periodLabel} | ${reportData.venueName}`,
          html,
          attachments: [{ filename, content: pdf.toString('base64') }],
        }))
      );

      if (results.every(r => r.success)) {
        // Advance next send by 30 days from the originally scheduled time to
        // avoid drift (e.g. if cron runs a few hours late).
        const prev = new Date(venue.report_schedule_next_at).getTime();
        const nextAt = new Date(prev + 30 * 86_400_000).toISOString();
        await supabaseAdmin
          .from('venues')
          .update({ report_schedule_next_at: nextAt } as Record<string, unknown>)
          .eq('id', venue.id);
        sent++;
      } else {
        failed++;
        console.warn(`[booking-report cron] partial failure for venue ${venue.id}`);
      }
    } catch (e) {
      failed++;
      console.error(`[booking-report cron] error for venue ${venue.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, processed: rows.length, sent, failed });
}
