import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const allowed = ['name', 'email', 'role', 'status'];
  const updates: Record<string, unknown> = {};
  for (const k of allowed) if (body[k] !== undefined) updates[k] = body[k];
  const { data, error } = await supabaseAdmin
    .from('venue_team_members').update(updates).eq('id', id).eq('venue_id', venueId).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await supabaseAdmin.from('venue_team_members').delete().eq('id', id).eq('venue_id', venueId);
  return NextResponse.json({ success: true });
}
