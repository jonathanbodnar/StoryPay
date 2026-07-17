/**
 * /api/listing/booking-report
 *
 * GET  — returns compiled report data + schedule settings (last 30 days).
 * POST — sends the summary email with the full PDF report attached.
 * PATCH — saves / updates the auto-send schedule.
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildBookingReportSummaryHtml } from '@/lib/booking-report-email';
import { buildBookingReportPdf } from '@/lib/booking-report-pdf';
import { compileBookingReport, bookingReportFilename } from '@/lib/booking-report-data';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { reportData, schedule } = await compileBookingReport(venueId);
  return NextResponse.json({ reportData, schedule });
}

// ── POST — send now (summary email + PDF attachment) ─────────────────────────

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body   = await req.json().catch(() => ({})) as { emails?: unknown };
  const emails = Array.isArray(body.emails)
    ? (body.emails as string[]).filter(e => typeof e === 'string' && e.includes('@'))
    : [];
  if (!emails.length) return NextResponse.json({ error: 'At least one valid email is required.' }, { status: 400 });

  const { reportData } = await compileBookingReport(venueId);
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

  const failed = results.filter(r => !r.success);
  if (failed.length) return NextResponse.json({ error: `Failed to send to ${failed.length} address(es).` }, { status: 500 });
  return NextResponse.json({ ok: true, sent: emails.length });
}

// ── PATCH — save schedule ─────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body    = await req.json().catch(() => ({})) as { enabled?: unknown; emails?: unknown };
  const enabled = body.enabled === true;
  const emails  = Array.isArray(body.emails)
    ? (body.emails as string[]).filter(e => typeof e === 'string' && e.includes('@')).slice(0, 10)
    : [];

  const nextAt = enabled ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null;

  const { error } = await supabaseAdmin
    .from('venues')
    .update({ report_schedule_enabled: enabled, report_schedule_emails: emails, report_schedule_next_at: nextAt } as Record<string, unknown>)
    .eq('id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, enabled, emails, nextAt });
}
