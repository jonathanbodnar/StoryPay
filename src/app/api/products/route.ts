import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const search = request.nextUrl.searchParams.get('search') || '';
  let q = supabaseAdmin
    .from('venue_products')
    .select('*')
    .eq('venue_id', venueId)
    .eq('active', true)
    .order('name', { ascending: true });

  if (search) q = q.ilike('name', `%${search}%`);

  const { data } = await q;
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, description, price, unit } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('venue_products')
    .insert({
      venue_id: venueId,
      name: name.trim(),
      description: description?.trim() || null,
      price: Math.round(parseFloat(price || '0') * 100),
      unit: unit || 'item',
    })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
