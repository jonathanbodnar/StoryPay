/**
 * GET /api/listing/booking-report/pdf
 *
 * Streams the full 30-day Bride Booking System™ report as a downloadable PDF —
 * the exact same document that gets attached to the report email.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { buildBookingReportPdf } from '@/lib/booking-report-pdf';
import { compileBookingReport, bookingReportFilename } from '@/lib/booking-report-data';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { reportData } = await compileBookingReport(venueId);
  const pdf = await buildBookingReportPdf(reportData);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${bookingReportFilename(reportData)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
