import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDb } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: venueId } = await params;
  const year  = parseInt(request.nextUrl.searchParams.get('year')  ?? String(new Date().getFullYear()), 10);
  const month = parseInt(request.nextUrl.searchParams.get('month') ?? String(new Date().getMonth() + 1), 10);

  const { data: venue } = await supabaseAdmin.from('venues').select('id, name').eq('id', venueId).single();
  if (!venue) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const from = new Date(year, month - 1, 1).toISOString();
  const to   = new Date(year, month, 0, 23, 59, 59).toISOString();

  try {
    const sql = getDb();
    const events = await sql`
      SELECT e.start_at, e.end_at, e.all_day, e.event_type,
             s.name AS space_name
      FROM calendar_events e
      LEFT JOIN venue_spaces s ON s.id = e.space_id
      WHERE e.venue_id = ${venueId}
        AND e.status != 'cancelled'
        AND e.start_at >= ${from}::timestamptz
        AND e.end_at   <= ${to}::timestamptz
    `;

    const booked = events.map(e => ({
      date: new Date(e.start_at).toISOString().slice(0, 10),
      event_type: e.event_type,
      space: e.space_name ?? null,
    }));

    return NextResponse.json({ venue: { name: venue.name }, booked, year, month });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
