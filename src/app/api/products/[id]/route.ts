import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

const RECURRENCE = new Set(['one_time', 'monthly', 'weekly']);
const INVENTORY_MODE = new Set(['unlimited', 'limited']);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.description !== undefined) updates.description = body.description?.trim() || null;
  if (body.price !== undefined) {
    updates.price = Math.round(parseFloat(String(body.price ?? '0')) * 100);
  }
  if (body.unit !== undefined) updates.unit = String(body.unit || 'item').trim() || 'item';
  if (body.recurrence !== undefined) {
    updates.recurrence = RECURRENCE.has(String(body.recurrence)) ? String(body.recurrence) : 'one_time';
  }
  if (body.inventory_mode !== undefined) {
    const m = INVENTORY_MODE.has(String(body.inventory_mode)) ? String(body.inventory_mode) : 'unlimited';
    updates.inventory_mode = m;
    if (m === 'unlimited') updates.inventory_quantity = null;
  }
  if (body.inventory_quantity !== undefined) {
    const mode =
      (updates.inventory_mode as string | undefined) ??
      (typeof body.inventory_mode === 'string' ? body.inventory_mode : undefined);
    if (mode === 'limited') {
      updates.inventory_quantity = Math.max(0, parseInt(String(body.inventory_quantity), 10) || 0);
    }
  }
  if (body.show_on_customer_portal !== undefined) {
    updates.show_on_customer_portal = Boolean(body.show_on_customer_portal);
  }
  if (body.active !== undefined) updates.active = Boolean(body.active);

  const { data, error } = await supabaseAdmin
    .from('venue_products')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select()
    .single();
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
