import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isPublicSponsoredStatus, isPublicVerifiedStatus } from '@/lib/directory-badges';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function corsHeaders() {
  const origin = process.env.PUBLIC_DIRECTORY_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/**
 * Published venues for directory browse/search (storyvenue.com city/state/search pages).
 * Query: state, city, q (name contains, case-insensitive). All optional.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const state = (searchParams.get('state') || '').trim();
  const city = (searchParams.get('city') || '').trim();
  const q = (searchParams.get('q') || '').trim();

  let query = supabaseAdmin
    .from('venues')
    .select(
      'id, slug, name, location_city, location_state, directory_verified_status, directory_sponsored_status',
    )
    .eq('is_published', true)
    .not('slug', 'is', null)
    .neq('slug', '');

  if (state) {
    query = query.ilike('location_state', state);
  }
  if (city) {
    query = query.ilike('location_city', `%${city}%`);
  }
  if (q) {
    query = query.ilike('name', `%${q}%`);
  }

  const { data: rows, error } = await query.order('name', { ascending: true }).limit(500);

  if (error) {
    console.error('[public/directory/venues]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders() });
  }

  const venues = (rows ?? []).map((r: Record<string, unknown>) => {
    const vs = r.directory_verified_status != null ? String(r.directory_verified_status) : 'none';
    const ss = r.directory_sponsored_status != null ? String(r.directory_sponsored_status) : 'none';
    return {
      slug: String(r.slug ?? ''),
      name: String(r.name ?? ''),
      location_city: r.location_city != null ? String(r.location_city) : null,
      location_state: r.location_state != null ? String(r.location_state) : null,
      listing_verified: isPublicVerifiedStatus(vs),
      listing_sponsored: isPublicSponsoredStatus(ss),
    };
  });

  venues.sort((a, b) => {
    const sp = (Number(b.listing_sponsored) - Number(a.listing_sponsored)) as number;
    if (sp !== 0) return sp;
    const vp = (Number(b.listing_verified) - Number(a.listing_verified)) as number;
    if (vp !== 0) return vp;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ venues }, { headers: corsHeaders() });
}
