import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TABLE_COLUMNS = 'id, name, capacity, sort_order, created_at';

async function ownsTable(tableId: string, coupleId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('wedding_tables')
    .select('id')
    .eq('id', tableId)
    .eq('couple_id', coupleId)
    .maybeSingle();
  return Boolean(data);
}

/** PATCH — rename / recapacity / reorder a table. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!(await ownsTable(id, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (!name) return NextResponse.json({ error: 'A table name is required.' }, { status: 400 });
    patch.name = name;
  }
  if ('capacity' in body) {
    const n = Number(body.capacity);
    patch.capacity = Number.isFinite(n) ? Math.min(100, Math.max(1, Math.round(n))) : 8;
  }
  if ('sort_order' in body) {
    const n = Number(body.sort_order);
    if (Number.isFinite(n)) patch.sort_order = Math.round(n);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No changes' }, { status: 400 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('wedding_tables')
    .update(patch)
    .eq('id', id)
    .eq('couple_id', user.id)
    .select(TABLE_COLUMNS)
    .single();

  if (error) {
    console.error('[couple/tables PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, table: updated });
}

/** DELETE — remove a table (its guests are auto-unassigned). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { error } = await supabaseAdmin
    .from('wedding_tables')
    .delete()
    .eq('id', id)
    .eq('couple_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
