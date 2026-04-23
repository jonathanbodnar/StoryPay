import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = (await request.json()) as {
    title?: string;
    description?: string;
    category?: string;
    version?: string | null;
    released_at?: string;
  };

  const updates: Record<string, unknown> = {};
  if (typeof body.title === 'string') {
    if (!body.title.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    updates.title = body.title.trim();
  }
  if (typeof body.description === 'string') updates.description = body.description.trim();
  if (typeof body.category === 'string') {
    const validCategories = ['feature', 'improvement', 'fix'];
    if (!validCategories.includes(body.category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }
    updates.category = body.category;
  }
  if (body.version !== undefined) updates.version = body.version?.trim() || null;
  if (typeof body.released_at === 'string') updates.released_at = body.released_at;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('changelog_entries')
    .update(updates)
    .eq('id', id)
    .select('id, title, description, category, version, released_at')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  // Unlink from any feature_request that references this entry.
  await supabaseAdmin
    .from('feature_requests')
    .update({ changelog_id: null })
    .eq('changelog_id', id);

  const { error } = await supabaseAdmin
    .from('changelog_entries')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
