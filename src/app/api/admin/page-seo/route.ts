import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabaseAdmin.from('page_seo').select('*').order('page_key');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function PUT(request: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  const { page_key, ...fields } = body;
  if (!page_key) return NextResponse.json({ error: 'page_key required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('page_seo')
    .upsert({ page_key, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'page_key' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
