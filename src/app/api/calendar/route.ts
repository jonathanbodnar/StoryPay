import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SpaceLite = { id: string; name: string; color: string };

// supabase-js returns a nested object when selecting a FK join. Normalize that
// to the single-row shape the UI expects: `venue_spaces: { id, name, color } | null`
function flattenSpace<T extends { venue_spaces?: SpaceLite | SpaceLite[] | null }>(row: T) {
  const v = row.venue_spaces;
  const flat = Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  return { ...row, venue_spaces: flat };
}

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to   = searchParams.get('to');

  let query = supabaseAdmin
    .from('calendar_events')
    .select('*, venue_spaces:space_id(id, name, color)')
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true });

  if (from) query = query.gte('start_at', from);
  if (to)   query = query.lte('start_at', to);

  const { data, error } = await query;

  if (error) {
    // If the FK embed fails (e.g. cache stale), fall back to a plain select.
    console.error('[calendar GET]', error);
    let plain = supabaseAdmin
      .from('calendar_events')
      .select('*')
      .eq('venue_id', venueId)
      .neq('status', 'cancelled')
      .order('start_at', { ascending: true });
    if (from) plain = plain.gte('start_at', from);
    if (to)   plain = plain.lte('start_at', to);
    const { data: rows, error: plainErr } = await plain;
    if (plainErr) return NextResponse.json({ error: plainErr.message }, { status: 500 });
    return NextResponse.json(rows ?? []);
  }

  return NextResponse.json((data ?? []).map(flattenSpace));
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    space_id, customer_email, title, event_type, status,
    start_at, end_at, all_day, proposal_id, notes, override_conflict,
  } = body;

  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (!start_at || !end_at) return NextResponse.json({ error: 'start_at and end_at are required' }, { status: 400 });
  if (new Date(end_at) <= new Date(start_at)) {
    return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 });
  }

  // Conflict detection: any overlapping non-cancelled event in the same space
  if (space_id && !override_conflict) {
    const { data: conflicts, error: conflictErr } = await supabaseAdmin
      .from('calendar_events')
      .select('id, title, start_at, end_at')
      .eq('venue_id', venueId)
      .eq('space_id', space_id)
      .neq('status', 'cancelled')
      .lt('start_at', end_at)
      .gt('end_at', start_at);
    if (conflictErr) {
      console.error('[calendar POST conflict]', conflictErr);
      return NextResponse.json({ error: conflictErr.message }, { status: 500 });
    }
    if ((conflicts ?? []).length > 0) {
      return NextResponse.json({
        error: 'conflict',
        message: 'This space already has an event during that time.',
        conflicts,
      }, { status: 409 });
    }
  }

  const { data: row, error } = await supabaseAdmin
    .from('calendar_events')
    .insert({
      venue_id:          venueId,
      space_id:          space_id || null,
      customer_email:    customer_email || null,
      title:             title.trim(),
      event_type:        event_type || 'other',
      status:            status || 'confirmed',
      start_at,
      end_at,
      all_day:           all_day ?? false,
      proposal_id:       proposal_id || null,
      notes:             notes || null,
      override_conflict: override_conflict ?? false,
    })
    .select('*, venue_spaces:space_id(id, name, color)')
    .single();

  if (error || !row) {
    console.error('[calendar POST insert]', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to create event' }, { status: 500 });
  }

  return NextResponse.json(flattenSpace(row), { status: 201 });
}
