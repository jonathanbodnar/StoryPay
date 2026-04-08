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
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined)        updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.price !== undefined)       updates.price = Math.round(parseFloat(body.price || '0') * 100);
  if (body.unit !== undefined)        updates.unit = body.unit;
  if (body.active !== undefined)      updates.active = body.active;

  const { data, error } = await supabaseAdmin
    .from('venue_products').update(updates).eq('id', id).eq('venue_id', venueId).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await supabaseAdmin.from('venue_products').update({ active: false }).eq('id', id).eq('venue_id', venueId);
  return NextResponse.json({ success: true });
}
