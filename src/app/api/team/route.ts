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

  // Use raw SQL to completely bypass PostgREST schema cache
  const { data, error } = await supabaseAdmin
    .from('venue_team_members')
    .select('id, venue_id, name, email, role, created_at')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[team] GET error:', error.message);
    // If schema cache error, try via RPC
    const { data: rpcData, error: rpcError } = await supabaseAdmin
      .rpc('get_team_members', { p_venue_id: venueId });
    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }
    return NextResponse.json(rpcData ?? []);
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

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedName  = name.trim();
  const normalizedRole  = role || 'member';

  // Direct .from() insert — works because supabaseAdmin uses service role key
  // which bypasses RLS. Schema cache only matters for REST schema introspection,
  // not for direct inserts when we know the column names.
  const { data, error } = await supabaseAdmin
    .from('venue_team_members')
    .upsert(
      { venue_id: venueId, name: normalizedName, email: normalizedEmail, role: normalizedRole },
      { onConflict: 'venue_id,email', ignoreDuplicates: false }
    )
    .select('id, venue_id, name, email, role, created_at')
    .single();

  if (error) {
    console.error('[team] POST error:', error.message);

    // Last resort: raw SQL insert via rpc passthrough
    const { data: sqlData, error: sqlError } = await supabaseAdmin.rpc('insert_team_member', {
      p_venue_id: venueId,
      p_name: normalizedName,
      p_email: normalizedEmail,
      p_role: normalizedRole,
    });

    if (sqlError) {
      console.error('[team] RPC fallback error:', sqlError.message);
      return NextResponse.json({ error: sqlError.message }, { status: 500 });
    }

    const row = Array.isArray(sqlData) ? sqlData[0] : sqlData;
    return NextResponse.json(row, { status: 201 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'Member id required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('venue_team_members')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) {
    // RPC fallback
    const { error: rpcError } = await supabaseAdmin.rpc('delete_team_member', {
      p_id: id,
      p_venue_id: venueId,
    });
    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
