import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Dynamic so a handle change (listing PATCH) is reflected immediately.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Short CDN cache — a bio short link is hit a lot but the mapping rarely changes.
const CACHE_TTL = 'public, s-maxage=30, stale-while-revalidate=0';

function corsHeaders() {
  const origin = process.env.PUBLIC_DIRECTORY_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': CACHE_TTL,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/**
 * Resolve a venue's short Lead Link handle → the venue slug (+ demo token).
 *
 * Powers the link-shortener redirect on storyvenue.com/v/<code>. Returns 404
 * for unknown/unpublished venues. Demo venues are intentionally unlisted but
 * still resolve here (their short link is the sanctioned way to show them off) —
 * and only for demo venues do we return the preview token, which is the
 * credential that unlocks their otherwise-hidden Lead Link page.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const handle = decodeURIComponent(code || '').trim().toLowerCase();

  if (!handle || !/^[a-z0-9-]{1,80}$/.test(handle)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: corsHeaders() });
  }

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, slug, is_published, is_demo, demo_preview_token')
    .ilike('lead_link_slug', handle) // exact, case-insensitive (handle has no wildcards)
    .maybeSingle();

  const row = data as {
    id: string | null;
    slug: string | null;
    is_published: boolean | null;
    is_demo: boolean | null;
    demo_preview_token: string | null;
  } | null;

  // Hidden unless published — the sole exception is a demo venue, which is
  // deliberately unlisted yet reachable via its short link.
  if (error || !row || !row.slug || (!row.is_published && !row.is_demo)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: corsHeaders() });
  }

  return NextResponse.json(
    {
      // venue_id lets the redirector attribute a short-link click (lead_link_scan)
      // to this venue. Not sensitive — it's already used publicly by the Lead Link
      // page's lead-capture form.
      venue_id: row.id,
      slug: row.slug,
      is_demo: row.is_demo === true,
      demo_preview_token: row.is_demo === true ? (row.demo_preview_token ?? null) : null,
    },
    { headers: corsHeaders() },
  );
}
