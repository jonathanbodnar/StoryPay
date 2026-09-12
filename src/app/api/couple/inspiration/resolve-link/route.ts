import { NextRequest, NextResponse } from 'next/server';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { fetchLinkPreview } from '@/lib/og-scrape';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST { url } — resolve a pasted link into a { imageUrl, title } preview for the
 * inspiration board. Auth-gated (couples only) since it fetches arbitrary URLs
 * server-side; the underlying helper is SSRF-guarded.
 */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
