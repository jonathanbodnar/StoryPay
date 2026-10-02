import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDb } from '@/lib/db';
import { expandEvent, isRecurrenceRule } from '@/lib/recurrence';
import { addCalendarDaysYmd, dateStrInTimeZone, resolveVenueTimezone, venueDayBoundsUtc } from '@/lib/venue-timezone';

/** An event that runs past midnight into these early hours doesn't take the next day too. */
const OVERNIGHT_MS = 6 * 60 * 60 * 1000;

/**
 * GET /api/availability/[venueId]?year=&month= — the venue's booked days for
 * its public availability calendar: dates only (in the venue's time zone),
 * with the kind of event and the space, never who booked.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: venueId } = await params;
  const now = new Date();
  const year  = parseInt(request.nextUrl.searchParams.get('year')  ?? String(now.getFullYear()), 10);
  const month = parseInt(request.nextUrl.searchParams.get('month') ?? String(now.getMonth() + 1), 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin.from('venues').select('id, name, timezone').eq('id', venueId).single();
  if (!venue) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // The month as the venue sees it on its own calendar.
  const tz = resolveVenueTimezone((venue as { timezone?: string | null }).timezone);
  const mm = String(month).padStart(2, '0');
  const firstDay = `${year}-${mm}-01`;
  const lastDay = `${year}-${mm}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
  const from = venueDayBoundsUtc(firstDay, tz).start;
  const to = venueDayBoundsUtc(lastDay, tz).end;

  try {
    const sql = getDb();
    // Everything that overlaps the month, including an event that starts the
    // month before, and repeating events however long ago they began.
    const events = await sql`
      SELECT e.id, e.start_at, e.end_at, e.all_day, e.event_type, e.recurrence_rule,
             s.name AS space_name
      FROM calendar_events e
      LEFT JOIN venue_spaces s ON s.id = e.space_id
      WHERE e.venue_id = ${venueId}
        AND e.status != 'cancelled'
        AND e.start_at <= ${to.toISOString()}::timestamptz
        AND (e.recurrence_rule IS NOT NULL OR e.end_at >= ${from.toISOString()}::timestamptz)
    `;

    const booked: Array<{ date: string; event_type: string; space: string | null }> = [];
    for (const e of events) {
      const occurrences = expandEvent(
        {
          id: String(e.id),
          start_at: new Date(e.start_at).toISOString(),
          end_at: new Date(e.end_at).toISOString(),
          recurrence_rule: isRecurrenceRule(e.recurrence_rule) ? e.recurrence_rule : null,
        },
        from,
        to,
      );
      for (const occ of occurrences) {
        // Every day the event takes, in the venue's time zone. A wedding that
        // ends at 1am only takes its own day.
        const start = new Date(occ.start_at).getTime();
        const last = Math.max(start, new Date(occ.end_at).getTime() - (e.all_day ? 1 : OVERNIGHT_MS));
        const lastDate = dateStrInTimeZone(new Date(last).toISOString(), tz);
        let day = dateStrInTimeZone(occ.start_at, tz);
        for (let n = 0; day <= lastDate && n < 62; n++) {
          if (day >= firstDay && day <= lastDay) {
            booked.push({ date: day, event_type: e.event_type, space: e.space_name ?? null });
          }
          day = addCalendarDaysYmd(day, 1, tz);
        }
      }
    }

    return NextResponse.json({ venue: { name: venue.name }, booked, year, month });
  } catch (err) {
    console.error('[availability]', err);
    return NextResponse.json({ error: 'Could not load availability' }, { status: 500 });
  }
}
