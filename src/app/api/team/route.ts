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

  const { data, error } = await supabaseAdmin
    .from('venue_team_members')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { first_name, last_name, email, role } = body;

  if (!first_name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: 'First name and email are required' }, { status: 400 });
  }

  const { count } = await supabaseAdmin
    .from('venue_team_members')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .eq('email', email.trim());

  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'A member with this email already exists.' }, { status: 409 });
  }

  const fullName = [first_name.trim(), (last_name || '').trim()].filter(Boolean).join(' ');

  const { data, error } = await supabaseAdmin
    .from('venue_team_members')
    .insert({
      venue_id: venueId,
      first_name: first_name.trim(),
      last_name: (last_name || '').trim(),
      name: fullName,
      email: email.trim(),
      role: role || 'member',
      status: 'active',
      invited_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
