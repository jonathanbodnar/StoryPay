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

export async function GET() {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('changelog_entries')
    .select('id, title, description, category, version, released_at, feature_request_id')
    .order('released_at', { ascending: false });

  if (error) {
    // feature_request_id column might not exist yet — retry without it
    if (/feature_request_id/i.test(error.message)) {
      const { data: plain, error: plainErr } = await supabaseAdmin
        .from('changelog_entries')
        .select('id, title, description, category, version, released_at')
        .order('released_at', { ascending: false });
      if (plainErr) return NextResponse.json({ error: plainErr.message }, { status: 500 });
      return NextResponse.json(plain ?? []);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as {
    title?: string;
    description?: string;
    category?: string;
    version?: string | null;
    released_at?: string;
  };

  if (!body.title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (!body.description?.trim()) return NextResponse.json({ error: 'Description is required' }, { status: 400 });

  const validCategories = ['feature', 'improvement', 'fix'];
  const category = validCategories.includes(body.category ?? '') ? body.category : 'feature';

  const { data, error } = await supabaseAdmin
    .from('changelog_entries')
    .insert({
      title: body.title.trim(),
      description: body.description.trim(),
      category,
      version: body.version?.trim() || null,
      released_at: body.released_at ?? new Date().toISOString(),
    })
    .select('id, title, description, category, version, released_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
