import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getActiveCoupleWedding } from '@/lib/couple-weddings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TABLE_COLUMNS = 'id, name, capacity, sort_order, created_at';

function clampCapacity(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 8;
  return Math.min(100, Math.max(1, Math.round(n)));
}

/** GET — the bride's reception tables for her linked wedding. */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }

  const { data, error } = await supabaseAdmin
    .from('wedding_tables')
    .select(TABLE_COLUMNS)
    .eq('couple_wedding_id', link.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tables: data ?? [] });
}

/** POST — create a table. Body: { name: string, capacity?: number } */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!name) return NextResponse.json({ error: 'A table name is required.' }, { status: 400 });

  // Append to the end of the current ordering.
  const { data: last } = await supabaseAdmin
    .from('wedding_tables')
    .select('sort_order')
    .eq('couple_wedding_id', link.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last as { sort_order?: number } | null)?.sort_order ?? -1) + 1;

  const { data: inserted, error } = await supabaseAdmin
    .from('wedding_tables')
    .insert({
      couple_wedding_id: link.id,
      couple_id: user.id,
      venue_id: link.venue_id,
      name,
      capacity: 'capacity' in body ? clampCapacity(body.capacity) : 8,
      sort_order: nextOrder,
    })
    .select(TABLE_COLUMNS)
    .single();

  if (error) {
    console.error('[couple/tables POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, table: inserted });
}
