/**
 * GET /api/public/directory/seo-index
 *
 * Lightweight index of every published venue for the directory site's
 * sitemap and city/state hub pages: slug, updated_at, city, state.
 * Public, CDN-cacheable for an hour.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CACHE_TTL = 'public, s-maxage=3600, stale-while-revalidate=86400';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': CACHE_TTL,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  // Paginate past the PostgREST 1,000-row limit
  const all: Array<{
    slug: string;
    updated_at: string | null;
    location_city: string | null;
    location_state: string | null;
  }> = [];

  const PAGE = 1000;
  for (let fromIdx = 0; ; fromIdx += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('venues')
      .select('slug, updated_at, location_city, location_state')
      .eq('is_published', true)
      .neq('is_demo', true)
      .not('slug', 'is', null)
      .neq('slug', '')
      .order('slug', { ascending: true })
      .range(fromIdx, fromIdx + PAGE - 1);

    if (error) {
      console.error('[seo-index]', error.message);
      return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders() });
    }
    const rows = (data ?? []) as typeof all;
    all.push(...rows);
    if (rows.length < PAGE) break;
  }

  return NextResponse.json({ venues: all }, { headers: corsHeaders() });
}
