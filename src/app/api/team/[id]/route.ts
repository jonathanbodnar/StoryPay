import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const allowed: Record<string, unknown> = {};
  if (body.first_name != null) allowed.first_name = body.first_name;
  if (body.last_name  != null) allowed.last_name  = body.last_name;
  if (body.email      != null) allowed.email      = body.email;
  if (body.role       != null) allowed.role       = body.role;
  if (body.status     != null) allowed.status     = body.status;

  if (allowed.first_name != null || allowed.last_name != null) {
    const { data: existing } = await supabaseAdmin
      .from('venue_team_members')
      .select('first_name, last_name')
      .eq('id', id)
      .eq('venue_id', venueId)
      .single();
    if (existing) {
      const fn = (allowed.first_name ?? existing.first_name ?? '') as string;
      const ln = (allowed.last_name  ?? existing.last_name  ?? '') as string;
      allowed.name = [fn, ln].filter(Boolean).join(' ');
    }
  }

  const { data, error } = await supabaseAdmin
    .from('venue_team_members')
    .update(allowed)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
