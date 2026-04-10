import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Use RPC to bypass PostgREST schema cache issues
  const { data, error } = await supabaseAdmin.rpc('get_team_members', { p_venue_id: venueId });
  if (error) {
    console.error('[team] get error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, email, role } = await request.json();
  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
  }

  // Use RPC to bypass PostgREST schema cache issues
  const { data, error } = await supabaseAdmin.rpc('insert_team_member', {
    p_venue_id: venueId,
    p_name: name.trim(),
    p_email: email.trim().toLowerCase(),
    p_role: role || 'member',
  });

  if (error) {
    console.error('[team] insert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // rpc returns an array for RETURNS TABLE — take first row
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'Member id required' }, { status: 400 });

  const { error } = await supabaseAdmin.rpc('delete_team_member', {
    p_id: id,
    p_venue_id: venueId,
  });

  if (error) {
    console.error('[team] delete error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
