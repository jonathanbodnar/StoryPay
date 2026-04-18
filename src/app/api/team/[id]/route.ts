import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';

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

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const updates: Record<string, string | boolean> = {};
  if (body.first_name != null) updates.first_name = body.first_name;
  if (body.last_name  != null) updates.last_name  = body.last_name;
  if (body.email      != null) updates.email      = body.email;
  if (body.role       != null) updates.role       = body.role;
  if (body.status     != null) updates.status     = body.status;
  if (body.hide_revenue !== undefined && typeof body.hide_revenue === 'boolean') {
    if (session.memberId !== null) {
      return NextResponse.json({ error: 'Only the venue owner can change revenue visibility' }, { status: 403 });
    }
    updates.hide_revenue = body.hide_revenue;
  }

  // Keep the denormalised name column in sync
  if (updates.first_name != null || updates.last_name != null) {
    const { data: current } = await supabaseAdmin
      .from('venue_team_members')
      .select('first_name, last_name')
      .eq('id', id)
      .eq('venue_id', venueId)
      .single();
    const fn = updates.first_name ?? current?.first_name ?? '';
    const ln = updates.last_name  ?? current?.last_name  ?? '';
    updates.name = [fn, ln].filter(Boolean).join(' ');
  }

  const { data, error } = await supabaseAdmin
    .from('venue_team_members')
    .update(updates)
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
