import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { tryCreateLunarPayProduct } from '@/lib/lunarpay';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

const RECURRENCE = new Set(['one_time', 'monthly', 'weekly']);
const INVENTORY_MODE = new Set(['unlimited', 'limited']);

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const search = request.nextUrl.searchParams.get('search') || '';
  const manage = request.nextUrl.searchParams.get('manage') === '1';

  let q = supabaseAdmin
    .from('venue_products')
    .select('*')
    .eq('venue_id', venueId)
    .order('name', { ascending: true });

  if (!manage) q = q.eq('active', true);
  if (search) q = q.ilike('name', `%${search}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    name,
    description,
    price,
    unit,
    recurrence: recIn,
    inventory_mode: invModeIn,
    inventory_quantity: invQtyIn,
    show_on_customer_portal: portalIn,
  } = body;

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const priceCents = Math.round(parseFloat(String(price ?? '0')) * 100);
  if (!Number.isFinite(priceCents) || priceCents < 0) {
    return NextResponse.json({ error: 'Valid price is required' }, { status: 400 });
  }

  const recurrence = RECURRENCE.has(String(recIn)) ? String(recIn) : 'one_time';
  const inventory_mode = INVENTORY_MODE.has(String(invModeIn)) ? String(invModeIn) : 'unlimited';
  const inventory_quantity =
    inventory_mode === 'limited' && invQtyIn != null && invQtyIn !== ''
      ? Math.max(0, parseInt(String(invQtyIn), 10) || 0)
      : null;

  const { data, error } = await supabaseAdmin
    .from('venue_products')
    .insert({
      venue_id: venueId,
      name: name.trim(),
      description: description?.trim() || null,
      price: priceCents,
      unit: (unit && String(unit).trim()) || 'item',
      recurrence,
      inventory_mode,
      inventory_quantity,
      show_on_customer_portal: Boolean(portalIn),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let row = data;
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', venueId)
    .maybeSingle();

  if (venue?.lunarpay_secret_key) {
    const lpId = await tryCreateLunarPayProduct(venue.lunarpay_secret_key, {
      name: row.name,
      description: row.description,
      priceCents: row.price,
      recurrence: row.recurrence,
    });
    if (lpId) {
      const { data: updated } = await supabaseAdmin
        .from('venue_products')
        .update({ lunarpay_product_id: lpId, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .select()
        .single();
      if (updated) row = updated;
    }
  }

  return NextResponse.json(row, { status: 201 });
}
