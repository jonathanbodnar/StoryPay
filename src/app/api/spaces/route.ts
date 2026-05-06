import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveVenueId } from '@/lib/effective-venue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const venueId = await getEffectiveVenueId(request);
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venue_spaces')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[spaces GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const venueId = await getEffectiveVenueId(request);
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, color, capacity, description } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { data: row, error } = await supabaseAdmin
    .from('venue_spaces')
    .insert({
      venue_id:    venueId,
      name:        name.trim(),
      color:       color || '#6366f1',
      capacity:    capacity || null,
      description: description || null,
    })
    .select('*')
    .single();

  if (error || !row) {
    console.error('[spaces POST]', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to save space' }, { status: 500 });
  }
  return NextResponse.json(row, { status: 201 });
}
