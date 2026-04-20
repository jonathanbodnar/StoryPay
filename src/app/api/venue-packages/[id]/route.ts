import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

const LINE_SELECT = `
  id, quantity, price_override_cents, sort_order,
  product_id,
  venue_products ( id, name, description, price, unit, active )
`;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from('venue_packages')
    .select(`*, venue_package_lines ( ${LINE_SELECT} )`)
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const lines = (data.venue_package_lines as unknown[]) ?? [];
  const sorted = [...lines].sort(
    (a, b) => (a as { sort_order: number }).sort_order - (b as { sort_order: number }).sort_order,
  );
  return NextResponse.json({ ...data, venue_package_lines: sorted });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.description !== undefined) updates.description = body.description?.trim() || null;
  if (body.season_label !== undefined) updates.season_label = body.season_label?.trim() || null;
  if (body.valid_from !== undefined) updates.valid_from = body.valid_from || null;
  if (body.valid_to !== undefined) updates.valid_to = body.valid_to || null;
  if (body.minimum_subtotal_cents !== undefined) {
    updates.minimum_subtotal_cents = Math.max(0, parseInt(String(body.minimum_subtotal_cents), 10) || 0);
  }
  if (body.sort_order !== undefined) updates.sort_order = parseInt(String(body.sort_order), 10) || 0;
  if (body.active !== undefined) updates.active = Boolean(body.active);

  const { error: ue } = await supabaseAdmin.from('venue_packages').update(updates).eq('id', id).eq('venue_id', venueId);
  if (ue) return NextResponse.json({ error: ue.message }, { status: 500 });

  if (Array.isArray(body.lines)) {
    await supabaseAdmin.from('venue_package_lines').delete().eq('package_id', id);
    if (body.lines.length > 0) {
      const inserts = body.lines.map((L: Record<string, unknown>, i: number) => ({
        package_id: id,
        product_id: String(L.product_id),
        quantity: Math.max(1, parseInt(String(L.quantity ?? '1'), 10) || 1),
        price_override_cents:
          L.price_override_cents != null && L.price_override_cents !== ''
            ? Math.max(0, parseInt(String(L.price_override_cents), 10))
            : null,
        sort_order: L.sort_order != null ? Number(L.sort_order) : i,
      }));
      const { error: le } = await supabaseAdmin.from('venue_package_lines').insert(inserts);
      if (le) return NextResponse.json({ error: le.message }, { status: 500 });
    }
  }

  const { data: full } = await supabaseAdmin
    .from('venue_packages')
    .select(`*, venue_package_lines ( ${LINE_SELECT} )`)
    .eq('id', id)
    .single();

  return NextResponse.json(full);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await supabaseAdmin.from('venue_packages').update({ active: false }).eq('id', id).eq('venue_id', venueId);
  return NextResponse.json({ success: true });
}
