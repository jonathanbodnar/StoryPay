import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/couple/wedding/search?q=...
 * Lightweight venue picker for a bride requesting to connect. Published venues only.
 */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('slug, name, cover_image_url, location_city, location_state')
    .eq('is_published', true)
    .ilike('name', like)
    .order('name', { ascending: true })
    .limit(12);

  if (error) {
    console.error('[couple/wedding/search]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? [])
    .filter((v) => (v as { slug?: string }).slug)
    .map((v) => {
      const row = v as {
        slug: string;
        name: string | null;
        cover_image_url: string | null;
        location_city: string | null;
        location_state: string | null;
      };
      return {
        slug: row.slug,
        name: row.name,
        cover_image_url: row.cover_image_url,
        location: [row.location_city, row.location_state].filter(Boolean).join(', ') || null,
      };
    });

  return NextResponse.json({ items });
}
