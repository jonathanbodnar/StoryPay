import { NextRequest, NextResponse } from 'next/server';
import { getPublicVenueBySlug } from '@/lib/public-venue-directory';

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
