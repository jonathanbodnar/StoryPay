import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = {};
  if ('name'        in body) updates.name        = body.name?.trim() || body.name;
  if ('color'       in body) updates.color       = body.color ?? null;
  if ('capacity'    in body) updates.capacity    = body.capacity ?? null;
  if ('description' in body) updates.description = body.description ?? null;
  if ('active'      in body) updates.active      = body.active ?? true;

  if (Object.keys(updates).length === 0) {
    const { data: current } = await supabaseAdmin
      .from('venue_spaces')
      .select('*')
      .eq('id', id)
      .eq('venue_id', venueId)
      .maybeSingle();
    return NextResponse.json(current ?? null);
  }

  const { data: row, error } = await supabaseAdmin
    .from('venue_spaces')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[spaces PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(row);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { error } = await supabaseAdmin
    .from('venue_spaces')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) {
    console.error('[spaces DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
