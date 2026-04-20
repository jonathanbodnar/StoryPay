import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const allowed = [
    'code',
    'name',
    'description',
    'discount_type',
    'discount_percent',
    'discount_amount_cents',
    'max_redemptions',
    'active',
  ] as const;
  const updates: Record<string, unknown> = {};
  for (const k of allowed) {
    if (body[k] !== undefined) updates[k] = body[k];
  }

  if (updates.discount_type === 'percent') {
    updates.discount_amount_cents = null;
  } else if (updates.discount_type === 'fixed_cents') {
    updates.discount_percent = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('venue_coupons')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ coupon: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('venue_coupons')
    .select('id, uses_count')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if ((row.uses_count ?? 0) > 0) {
    const { data: updated, error: uErr } = await supabaseAdmin
      .from('venue_coupons')
      .update({ active: false })
      .eq('id', id)
      .eq('venue_id', venueId)
      .select('*')
      .single();
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    return NextResponse.json({ coupon: updated, deactivated: true });
  }

  const { error: delErr } = await supabaseAdmin.from('venue_coupons').delete().eq('id', id).eq('venue_id', venueId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
