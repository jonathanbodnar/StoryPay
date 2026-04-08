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
  const { data } = await supabaseAdmin
    .from('venue_team_members')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { name, email, role } = await request.json();
  if (!name?.trim() || !email?.trim()) return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from('venue_team_members')
    .insert({ venue_id: venueId, name: name.trim(), email: email.trim().toLowerCase(), role: role || 'member' })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
