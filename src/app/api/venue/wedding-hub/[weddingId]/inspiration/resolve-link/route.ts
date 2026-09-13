import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { fetchLinkPreview } from '@/lib/og-scrape';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST { url } — resolve a pasted link into a { imageUrl, title } preview for the
 * venue-side inspiration board. Mirrors the couple route (src/app/api/couple/
 * inspiration/resolve-link/route.ts); venue-authed instead of couple-authed.
 */
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const url = typeof body.url === 'string' ? body.url : '';
  if (!url.trim()) return NextResponse.json({ error: 'url is required' }, { status: 400 });

  const preview = await fetchLinkPreview(url);
  return NextResponse.json({ preview });
}
