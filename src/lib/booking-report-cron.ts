/**
 * Scheduled Bride Booking System™ reports: every venue that switched them on
 * (report_schedule_enabled) gets the 30-day report by email, with the PDF
 * attached, each time report_schedule_next_at comes due.
 *
 * Run by /api/cron/send-booking-reports. Each venue is claimed by moving its
 * next date forward before anything is sent, so two runs can never email the
 * same venue twice; a failed send puts the date back so the next run retries.
 */
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildBookingReportSummaryHtml } from '@/lib/booking-report-email';
import { buildBookingReportPdf } from '@/lib/booking-report-pdf';
import { compileBookingReport, bookingReportFilename } from '@/lib/booking-report-data';
import { nextReportAt } from '@/lib/booking-report-schedule';

export interface BookingReportRun { processed: number; sent: number; failed: number; skipped: number }

export async function runBookingReports(): Promise<BookingReportRun> {
  const now = Date.now();
  const { data: venues, error } = await supabaseAdmin
    .from('venues')
    .select('id, report_schedule_emails, report_schedule_next_at')
    .eq('report_schedule_enabled', true)
    .not('report_schedule_next_at', 'is', null)
    .lte('report_schedule_next_at', new Date(now).toISOString());
  if (error) throw new Error(`booking reports: ${error.message}`);

  type Row = { id: string; report_schedule_emails: string[] | null; report_schedule_next_at: string };
  const rows = (venues ?? []) as Row[];
  const result: BookingReportRun = { processed: rows.length, sent: 0, failed: 0, skipped: 0 };

  for (const venue of rows) {
    const emails = (venue.report_schedule_emails ?? []).filter((e) => e.includes('@'));
    if (!emails.length) { result.skipped++; continue; }

    // Claim: only the run that moves the date forward sends this report.
    const nextAt = nextReportAt(venue.report_schedule_next_at, now);
    const { data: claimed } = await supabaseAdmin
      .from('venues')
      .update({ report_schedule_next_at: nextAt } as Record<string, unknown>)
      .eq('id', venue.id)
      .eq('report_schedule_next_at', venue.report_schedule_next_at)
      .select('id');
    if (!claimed?.length) { result.skipped++; continue; }

    let ok = false;
    try {
      const { reportData } = await compileBookingReport(venue.id);
      const html = buildBookingReportSummaryHtml(reportData);
      const pdf = await buildBookingReportPdf(reportData);
      const filename = bookingReportFilename(reportData);
      const sends = await Promise.all(emails.map((to) => sendEmail({
        to,
        subject: `Bride Booking System™ Report — ${reportData.periodLabel} | ${reportData.venueName}`,
        html,
        attachments: [{ filename, content: pdf.toString('base64') }],
      })));
      ok = sends.some((r) => r.success);
      if (!sends.every((r) => r.success)) console.warn(`[booking-reports] venue ${venue.id}: ${sends.filter((r) => !r.success).length} of ${sends.length} emails failed`);
    } catch (e) {
      console.error(`[booking-reports] venue ${venue.id}:`, e instanceof Error ? e.message : e);
    }

    if (ok) {
      result.sent++;
    } else {
      result.failed++;
      // Nobody got it: put the date back so the next run tries again.
      await supabaseAdmin
        .from('venues')
        .update({ report_schedule_next_at: venue.report_schedule_next_at } as Record<string, unknown>)
        .eq('id', venue.id)
        .eq('report_schedule_next_at', nextAt);
    }
  }
  return result;
}
