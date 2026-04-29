import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venue_availability')
    .select('*')
    .eq('venue_id', venueId)
    .order('day_of_week');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If fewer than 7 rows, seed/fill any missing days with defaults (Mon–Fri 9–5)
  if (!data || data.length < 7) {
    const existingDays = new Set((data ?? []).map((r: { day_of_week: number }) => r.day_of_week));
    const missing = Array.from({ length: 7 }, (_, i) => i).filter((i) => !existingDays.has(i));
    if (missing.length > 0) {
      const defaults = missing.map((i) => ({
        venue_id: venueId,
        day_of_week: i,
        is_available: i >= 1 && i <= 5,
        start_time: '09:00:00',
        end_time: '17:00:00',
      }));
      await supabaseAdmin
        .from('venue_availability')
        .upsert(defaults, { onConflict: 'venue_id,day_of_week' });
      // Re-fetch after seeding
      const { data: refetched } = await supabaseAdmin
        .from('venue_availability')
        .select('*')
        .eq('venue_id', venueId)
        .order('day_of_week');
      return NextResponse.json(refetched ?? []);
    }
  }

  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows: Array<{
    day_of_week: number;
    is_available: boolean;
    start_time: string;
    end_time: string;
  }> = await req.json();

  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: 'Expected array of availability rows' }, { status: 400 });
  }

  const upserts = rows.map((r) => ({
    venue_id: venueId,
    day_of_week: r.day_of_week,
    is_available: r.is_available,
    start_time: r.start_time,
    end_time: r.end_time,
  }));

  const { data, error } = await supabaseAdmin
    .from('venue_availability')
    .upsert(upserts, { onConflict: 'venue_id,day_of_week' })
    .select()
    .order('day_of_week');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
