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

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const manage = request.nextUrl.searchParams.get('manage') === '1';
  let q = supabaseAdmin
    .from('venue_packages')
    .select(
      `
      *,
      venue_package_lines ( ${LINE_SELECT} )
    `,
    )
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (!manage) q = q.eq('active', true);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((pkg: Record<string, unknown>) => {
    const lines = (pkg.venue_package_lines as unknown[]) ?? [];
    const sorted = [...lines].sort(
      (a, b) => (a as { sort_order: number }).sort_order - (b as { sort_order: number }).sort_order,
    );
    return { ...pkg, venue_package_lines: sorted };
  });

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    name,
    description,
    season_label,
    valid_from,
    valid_to,
    minimum_subtotal_cents,
    sort_order,
    template_id,
    lines,
  } = body;

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const minCents = Math.max(0, parseInt(String(minimum_subtotal_cents ?? '0'), 10) || 0);
  const lineRows = Array.isArray(lines) ? lines : [];

  const insertRow: Record<string, unknown> = {
    venue_id: venueId,
    name: name.trim(),
    description: description?.trim() || null,
    season_label: season_label?.trim() || null,
    valid_from: valid_from || null,
    valid_to: valid_to || null,
    minimum_subtotal_cents: minCents,
    sort_order: sort_order != null ? parseInt(String(sort_order), 10) || 0 : 0,
    active: true,
    template_id: template_id || null,
  };

  // Tolerant of pre-migration-156 DBs that lack template_id.
  let { data: pkg, error: pe } = await supabaseAdmin
    .from('venue_packages')
    .insert(insertRow)
    .select()
    .single();
  if (pe && (pe.code === '42703' || pe.code === 'PGRST204')) {
    const { template_id: _t, ...fallback } = insertRow;
    void _t;
    ({ data: pkg, error: pe } = await supabaseAdmin
      .from('venue_packages')
      .insert(fallback)
      .select()
      .single());
  }

  if (pe) return NextResponse.json({ error: pe.message }, { status: 500 });

  if (lineRows.length > 0) {
    const inserts = lineRows.map((L: Record<string, unknown>, i: number) => ({
      package_id: pkg.id,
      product_id: String(L.product_id),
      quantity: Math.max(1, parseInt(String(L.quantity ?? '1'), 10) || 1),
      price_override_cents:
        L.price_override_cents != null && L.price_override_cents !== ''
          ? Math.max(0, parseInt(String(L.price_override_cents), 10))
          : null,
      sort_order: L.sort_order != null ? Number(L.sort_order) : i,
    }));
    const { error: le } = await supabaseAdmin.from('venue_package_lines').insert(inserts);
    if (le) {
      await supabaseAdmin.from('venue_packages').delete().eq('id', pkg.id);
      return NextResponse.json({ error: le.message }, { status: 500 });
    }
  }

  const { data: full } = await supabaseAdmin
    .from('venue_packages')
    .select(`*, venue_package_lines ( ${LINE_SELECT} )`)
    .eq('id', pkg.id)
    .single();

  return NextResponse.json(full ?? pkg, { status: 201 });
}
