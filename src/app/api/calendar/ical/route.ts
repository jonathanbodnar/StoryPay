import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Public iCal feed — authenticated by venue token in query param (?token=venue_id)
// so venue owners can subscribe from Google Calendar / Apple Calendar.
function escapeIcal(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toIcalDate(iso: string, allDay = false): string {
  if (allDay) return iso.slice(0, 10).replace(/-/g, '');
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const venueId = searchParams.get('token');
  if (!venueId) return new NextResponse('Missing token', { status: 400 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name')
    .eq('id', venueId)
    .single();

  if (!venue) return new NextResponse('Not found', { status: 404 });

  const { data: events } = await supabaseAdmin
    .from('calendar_events')
    .select('id, title, event_type, status, start_at, end_at, all_day, notes, customer_email')
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true });

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//StoryPay//${escapeIcal(venue.name)}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcal(venue.name)} — Events`,
    'X-WR-TIMEZONE:America/New_York',
  ];

  for (const evt of events ?? []) {
    const dtStart = evt.all_day
      ? `DTSTART;VALUE=DATE:${toIcalDate(evt.start_at, true)}`
      : `DTSTART:${toIcalDate(evt.start_at)}`;
    const dtEnd = evt.all_day
      ? `DTEND;VALUE=DATE:${toIcalDate(evt.end_at, true)}`
      : `DTEND:${toIcalDate(evt.end_at)}`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${evt.id}@storypay`);
    lines.push(dtStart);
    lines.push(dtEnd);
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
}
