import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KEY_RE = /^[a-z][a-z0-9_]{1,63}$/;

export async function GET() {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin
    .from('directory_feature_definitions')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ features: data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { feature_key?: string; label?: string; description?: string | null; category?: string | null; sort_order?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const key = (body.feature_key || '').trim().toLowerCase();
  const label = (body.label || '').trim();
  if (!key || !label) return NextResponse.json({ error: 'feature_key and label required' }, { status: 400 });
  if (!KEY_RE.test(key)) {
    return NextResponse.json(
      { error: 'feature_key must be lowercase snake_case (letters, numbers, underscore).' },
      { status: 400 },
    );
  }
  const { data, error } = await supabaseAdmin
    .from('directory_feature_definitions')
    .insert({
      feature_key: key,
      label,
      description: body.description?.trim() || null,
      category: body.category?.trim() || null,
      sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
    })
    .select('*')
    .single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: 'Feature key already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ feature: data }, { status: 201 });
}
