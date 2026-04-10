import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from('venue_team_members')
    .select('id, venue_id, name, first_name, last_name, email, role, status, avatar_url, created_at, invited_at')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const updateFields: Record<string, unknown> = {};

  if (body.role !== undefined) updateFields.role = body.role;
  if (body.status !== undefined) updateFields.status = body.status;
  if (body.first_name !== undefined) {
    updateFields.first_name = body.first_name.trim();
    const fullName = [body.first_name.trim(), (body.last_name ?? '').trim()].filter(Boolean).join(' ');
    updateFields.name = fullName;
  }
  if (body.last_name !== undefined) {
    updateFields.last_name = body.last_name.trim();
    if (!updateFields.name) {
      const { data: current } = await supabaseAdmin
        .from('venue_team_members')
        .select('first_name')
        .eq('id', id)
        .eq('venue_id', venueId)
        .single();
      const fn = body.first_name?.trim() ?? current?.first_name ?? '';
      updateFields.name = [fn, body.last_name.trim()].filter(Boolean).join(' ');
    }
  }
  if (body.email !== undefined) updateFields.email = body.email.trim().toLowerCase();

  if (Object.keys(updateFields).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('venue_team_members')
    .update(updateFields)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id, venue_id, name, first_name, last_name, email, role, status, avatar_url, created_at, invited_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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
    .from('venue_team_members')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
