import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data: member, error: fetchError } = await supabaseAdmin
    .from('venue_team_members')
    .select('id, email, status')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (fetchError || !member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from('venue_team_members')
    .update({ status: 'invited', invited_at: new Date().toISOString() })
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: 'Invite resent successfully' });
}
