import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** PUT /api/venue-calendars/[id] — update a calendar */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await request.json() as {
    name?: string;
    color?: string;
    description?: string;
    is_default?: boolean;
    sort_order?: number;
  };

  const updates: Record<string, unknown> = {};
  if ('name'        in body) updates.name        = body.name?.trim();
  if ('color'       in body) updates.color       = body.color;
  if ('description' in body) updates.description = body.description?.trim() || null;
  if ('sort_order'  in body) updates.sort_order  = body.sort_order;

  if ('is_default' in body && body.is_default) {
    // Clear existing default for this venue first
    await supabaseAdmin
      .from('venue_calendars')
      .update({ is_default: false })
      .eq('venue_id', venueId)
      .eq('is_default', true)
      .neq('id', id);
    updates.is_default = true;
  }

  if (Object.keys(updates).length === 0) {
    const { data } = await supabaseAdmin.from('venue_calendars').select('*').eq('id', id).eq('venue_id', venueId).maybeSingle();
    return NextResponse.json(data);
  }

  const { data, error } = await supabaseAdmin
    .from('venue_calendars')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** DELETE /api/venue-calendars/[id] — delete a calendar */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  // Check it's not the only calendar
  const { data: all } = await supabaseAdmin
    .from('venue_calendars')
    .select('id')
    .eq('venue_id', venueId);

  if ((all ?? []).length <= 1) {
    return NextResponse.json({ error: 'Cannot delete the only calendar. Create another first.' }, { status: 400 });
  }

  // Find the default (to reassign events if needed)
  const { data: defaultCal } = await supabaseAdmin
    .from('venue_calendars')
    .select('id')
    .eq('venue_id', venueId)
    .eq('is_default', true)
    .neq('id', id)
    .maybeSingle();

  // Move events that belonged to this calendar to the default (or null)
  const reassignTo = defaultCal ? (defaultCal as { id: string }).id : null;
  await supabaseAdmin
    .from('calendar_events')
    .update({ calendar_id: reassignTo })
    .eq('venue_id', venueId)
    .eq('calendar_id', id);

  const { error } = await supabaseAdmin
    .from('venue_calendars')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
