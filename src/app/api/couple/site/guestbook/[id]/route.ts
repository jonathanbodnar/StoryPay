import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function assertOwned(userId: string, id: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('couple_guestbook_entries')
    .select('id')
    .eq('id', id)
    .eq('couple_id', userId)
    .maybeSingle();
  return Boolean(data);
}

/** PATCH — hide/unhide (approve) an entry. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!(await assertOwned(user.id, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { is_hidden?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('couple_guestbook_entries')
    .update({ is_hidden: Boolean(body.is_hidden) })
    .eq('id', id)
    .select('id, guest_name, message, is_hidden, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry: data });
}

/** DELETE — permanently remove an entry. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!(await assertOwned(user.id, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error } = await supabaseAdmin.from('couple_guestbook_entries').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
