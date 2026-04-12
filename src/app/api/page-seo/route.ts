import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  const { data } = await supabaseAdmin
    .from('page_seo')
    .select('*')
    .eq('page_key', key)
    .maybeSingle();

  return NextResponse.json(data ?? {});
}
