import { NextRequest, NextResponse } from 'next/server';
import { getPublicVenueBySlug } from '@/lib/public-venue-directory';

// This is a public, unauthenticated GET — allow CDN (Cloudflare) to cache it.
export const revalidate = 60; // ISR: refresh the cached response every 60 s
export const runtime = 'nodejs';

const CACHE_TTL = 'public, s-maxage=60, stale-while-revalidate=300';

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
 * Public directory payload: published venue profile + published listing reviews.
 * Consumed by storyvenue.com (or any origin allowed by PUBLIC_DIRECTORY_ORIGIN).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: rawSlug } = await params;
  const data = await getPublicVenueBySlug(rawSlug || '');
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: corsHeaders() });
  }

  return NextResponse.json(data, { headers: corsHeaders() });
}
