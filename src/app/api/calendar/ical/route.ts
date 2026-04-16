import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDb } from '@/lib/db';

function escapeIcal(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toIcalDate(iso: string, allDay = false): string {
  if (allDay) return new Date(iso).toISOString().slice(0, 10).replace(/-/g, '');
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export async function GET(request: NextRequest) {
  const venueId = request.nextUrl.searchParams.get('token');
  if (!venueId) return new NextResponse('Missing token', { status: 400 });

  const { data: venue } = await supabaseAdmin.from('venues').select('name').eq('id', venueId).single();
  if (!venue) return new NextResponse('Not found', { status: 404 });

  try {
    const sql = getDb();
    const events = await sql`
      SELECT id, title, event_type, status, start_at, end_at, all_day, notes, customer_email
      FROM calendar_events
      WHERE venue_id = ${venueId} AND status != 'cancelled'
      ORDER BY start_at ASC
    `;

    const lines: string[] = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      `PRODID:-//StoryPay//${escapeIcal(venue.name)}//EN`,
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeIcal(venue.name)} — Events`,
      'X-WR-TIMEZONE:America/New_York',
    ];

    for (const evt of events) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${evt.id}@storypay`);
      lines.push(evt.all_day ? `DTSTART;VALUE=DATE:${toIcalDate(evt.start_at, true)}` : `DTSTART:${toIcalDate(evt.start_at)}`);
      lines.push(evt.all_day ? `DTEND;VALUE=DATE:${toIcalDate(evt.end_at, true)}`   : `DTEND:${toIcalDate(evt.end_at)}`);
      lines.push(`SUMMARY:${escapeIcal(evt.title)}`);
      if (evt.notes) lines.push(`DESCRIPTION:${escapeIcal(evt.notes)}`);
      if (evt.customer_email) lines.push(`ATTENDEE;CN=${escapeIcal(evt.customer_email)}:mailto:${evt.customer_email}`);
      lines.push(`STATUS:${evt.status === 'tentative' ? 'TENTATIVE' : 'CONFIRMED'}`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');

    return new NextResponse(lines.join('\r\n'), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${venue.name.replace(/[^a-z0-9]/gi, '-')}-calendar.ics"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    return new NextResponse(String(err), { status: 500 });
  }
}
