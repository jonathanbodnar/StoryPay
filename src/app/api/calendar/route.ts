import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');  // ISO date string
  const to   = searchParams.get('to');

  let q = supabaseAdmin
    .from('calendar_events')
    .select('*, venue_spaces(id, name, color)')
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true });

  if (from) q = q.gte('start_at', from);
  if (to)   q = q.lte('start_at', to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
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
  if (new Date(end_at) <= new Date(start_at)) return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 });

  // ── Conflict detection ────────────────────────────────────────────────────
  // Only applies when a space is selected and not explicitly overriding.
  if (space_id && !override_conflict) {
    const { data: conflicts } = await supabaseAdmin
      .from('calendar_events')
      .select('id, title, start_at, end_at')
      .eq('venue_id', venueId)
      .eq('space_id', space_id)
      .neq('status', 'cancelled')
      .lt('start_at', end_at)
      .gt('end_at', start_at);

    if (conflicts && conflicts.length > 0) {
      return NextResponse.json(
        {
          error: 'conflict',
          message: 'This space already has an event during that time.',
          conflicts: conflicts.map(c => ({ id: c.id, title: c.title, start_at: c.start_at, end_at: c.end_at })),
        },
        { status: 409 }
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from('calendar_events')
    .insert({
      venue_id: venueId,
      space_id: space_id || null,
      customer_email: customer_email || null,
      title: title.trim(),
      event_type: event_type || 'other',
      status: status || 'confirmed',
      start_at,
      end_at,
      all_day: all_day ?? false,
      proposal_id: proposal_id || null,
      notes: notes || null,
      override_conflict: override_conflict ?? false,
    })
    .select('*, venue_spaces(id, name, color)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
