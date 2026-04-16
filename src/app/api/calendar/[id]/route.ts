import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await request.json();
  const {
    space_id, customer_email, title, event_type, status,
    start_at, end_at, all_day, notes, override_conflict,
  } = body;

  // Conflict check on reschedule if space changed or time changed
  if (space_id && !override_conflict && (start_at || end_at)) {
    const { data: current } = await supabaseAdmin
      .from('calendar_events')
      .select('start_at, end_at')
      .eq('id', id)
      .single();

    const newStart = start_at ?? current?.start_at;
    const newEnd   = end_at   ?? current?.end_at;

    const { data: conflicts } = await supabaseAdmin
      .from('calendar_events')
      .select('id, title, start_at, end_at')
      .eq('venue_id', venueId)
      .eq('space_id', space_id)
      .neq('status', 'cancelled')
      .neq('id', id)
      .lt('start_at', newEnd)
      .gt('end_at', newStart);

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

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (space_id !== undefined)        update.space_id        = space_id || null;
  if (customer_email !== undefined)  update.customer_email  = customer_email || null;
  if (title !== undefined)           update.title           = title.trim();
  if (event_type !== undefined)      update.event_type      = event_type;
  if (status !== undefined)          update.status          = status;
  if (start_at !== undefined)        update.start_at        = start_at;
  if (end_at !== undefined)          update.end_at          = end_at;
  if (all_day !== undefined)         update.all_day         = all_day;
  if (notes !== undefined)           update.notes           = notes;
  if (override_conflict !== undefined) update.override_conflict = override_conflict;

  const { data, error } = await supabaseAdmin
    .from('calendar_events')
    .update(update)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('*, venue_spaces(id, name, color)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { error } = await supabaseAdmin
    .from('calendar_events')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
