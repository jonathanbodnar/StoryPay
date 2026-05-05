/**
 * PATCH  /api/admin/support/canned-replies/[id]  update (super admin OR support_admin)
 * DELETE /api/admin/support/canned-replies/[id]  delete (super admin OR support_admin)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await verifySupportAccess();
  const canAuthor = auth.isSuperAdmin || auth.agent?.role === 'support_admin';
  if (!canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;

  let body: {
    title?: string;
    body?: string;
    scope?: 'admin' | 'venue' | 'both';
    shortcut?: string | null;
    category?: string | null;
    channels?: ('sms' | 'email')[];
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    update.title = t;
  }
  if (typeof body.body === 'string') {
    const b = body.body.trim();
    if (!b) return NextResponse.json({ error: 'body cannot be empty' }, { status: 400 });
    update.body = b;
  }
  if (body.scope === 'admin' || body.scope === 'venue' || body.scope === 'both') {
    update.scope = body.scope;
  }
  if (body.shortcut !== undefined) update.shortcut = body.shortcut?.trim() || null;
  if (body.category !== undefined) update.category = body.category?.trim() || null;
  if (Array.isArray(body.channels)) {
    update.channels = body.channels.filter(c => c === 'sms' || c === 'email');
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('support_canned_replies')
    .update(update)
    .eq('id', id)
    .select('id, title, body, scope, shortcut, category, channels, use_count, updated_at, created_at')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ template: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await verifySupportAccess();
  const canAuthor = auth.isSuperAdmin || auth.agent?.role === 'support_admin';
  if (!canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const { error } = await supabaseAdmin
    .from('support_canned_replies')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
