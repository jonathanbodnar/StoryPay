import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export type VenueCalendar = {
  id: string;
  venue_id: string;
  name: string;
  color: string;
  description: string | null;
  is_default: boolean;
  sort_order: number;
  created_at: string;
};

/** GET /api/venue-calendars — list all calendars for the authenticated venue */
export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venue_calendars')
    .select('*')
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    // Table doesn't exist yet (migration not run)
    if (error.message?.includes('venue_calendars') || error.code === '42P01') {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

/** POST /api/venue-calendars — create a new calendar */
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json() as {
    name?: string;
    color?: string;
    description?: string;
    is_default?: boolean;
  };

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  // Enforce 3-calendar maximum per venue
  const { count, error: countErr } = await supabaseAdmin
    .from('venue_calendars')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if ((count ?? 0) >= 3) {
    return NextResponse.json(
      { error: 'You can have a maximum of 3 calendars. Delete one before creating another.' },
      { status: 400 },
    );
  }

  // If setting as default, clear existing default first
  if (body.is_default) {
    await supabaseAdmin
      .from('venue_calendars')
      .update({ is_default: false })
      .eq('venue_id', venueId)
      .eq('is_default', true);
  }

  const { data, error } = await supabaseAdmin
    .from('venue_calendars')
    .insert({
      venue_id: venueId,
      name,
      color: body.color ?? '#1b1b1b',
      description: body.description?.trim() || null,
      is_default: body.is_default ?? false,
      sort_order: 0,
    })
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
