/**
 * GET /api/link-preview-image?url=<encoded>
 *
 * Proxies a link preview's image (og:image) for the support inbox's
 * LinkPreviewCard, so the browser never requests the source site directly
 * (many sites block hotlinked images).
 *
 * Because the response comes from app.storyvenue.com, it must never carry
 * anything a browser would run:
 *   - Admin and support sign-in only (the support inbox is its only user).
 *   - Real photo formats only (PNG, JPEG, GIF, WebP, AVIF), decided from the
 *     file's own bytes, never from the source's Content-Type. SVG and anything
 *     else is refused.
 *   - A sandboxing Content-Security-Policy on the response as a second guard.
 *   - Every hop, redirects included, must reach a public address
 *     (lib/safe-outbound-fetch). 2 MB cap, 5 s timeout.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { safeFetch } from '@/lib/safe-outbound-fetch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

/** The image format, read from the file's first bytes; null when it isn't one we serve. */
function sniffImageType(b: Buffer): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6) {
    const head = b.subarray(0, 6).toString('ascii');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

export async function GET(req: NextRequest) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) return new NextResponse('unauthorized', { status: 401 });

  const raw = req.nextUrl.searchParams.get('url')?.trim();
  if (!raw) return new NextResponse('url required', { status: 400 });
  try {
    new URL(raw);
  } catch {
    return new NextResponse('invalid url', { status: 400 });
  }

  try {
    const upstream = await safeFetch(raw, {
      accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1',
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: 5000,
    });
    if (upstream.status < 200 || upstream.status >= 300) return new NextResponse('upstream error', { status: 502 });
    if (upstream.truncated) return new NextResponse('image too large', { status: 413 });

    const type = sniffImageType(upstream.body);
    if (!type) return new NextResponse('not a supported image', { status: 415 });

    return new NextResponse(new Uint8Array(upstream.body), {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Disposition': 'inline',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('fetch failed', { status: 502 });
  }
}
