import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Public — no auth. token = venue_id (same as iCal feed)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: venueId } = await params;
  const { searchParams } = request.nextUrl;
  const year  = parseInt(searchParams.get('year')  ?? String(new Date().getFullYear()), 10);
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1), 10);

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const from = new Date(year, month - 1, 1).toISOString();
  const to   = new Date(year, month, 0, 23, 59, 59).toISOString();

  const { data: events } = await supabaseAdmin
    .from('calendar_events')
    .select('id, start_at, end_at, all_day, event_type, space_id, venue_spaces(name)')
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .gte('start_at', from)
    .lte('end_at', to);

  // Return only "booked" dates — no customer info exposed
  const booked = (events ?? []).map(e => ({
    date: e.start_at.slice(0, 10),
    event_type: e.event_type,
    space: (e.venue_spaces as unknown as { name: string } | null)?.name ?? null,
  }));

  return NextResponse.json({ venue: { name: venue.name }, booked, year, month });
}
