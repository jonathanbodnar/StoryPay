import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const category = searchParams.get('category');
  const tag      = searchParams.get('tag');
  const limit    = parseInt(searchParams.get('limit') || '20');
  const q        = searchParams.get('q');

  let query = supabaseAdmin
    .from('blog_posts')
    .select('id, slug, title, meta_description, excerpt, featured_image, author_name, author_image, category, tags, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);

  if (category) query = query.eq('category', category);
  if (tag)      query = query.contains('tags', [tag]);
  if (q)        query = query.ilike('title', `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
