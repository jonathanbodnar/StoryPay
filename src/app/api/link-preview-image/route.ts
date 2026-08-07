/**
 * GET /api/link-preview-image?url=<encoded>
 *
 * Proxies an OG image so the browser never makes a cross-origin request
 * to the source domain.  Many sites block direct hotlinking of OG images
 * (hotlink-protection CDN rules, missing CORS headers, Referer checks),
 * which causes the raw <img src="..."> in LinkPreviewCard to show a
 * broken-image placeholder even though the image URL is valid.
 *
 * Security guardrails mirror the parent /api/link-preview route:
 *   - Only http/https URLs accepted.
 *   - SSRF guard: hostnames that resolve to private/loopback/link-local
 *     IP ranges are rejected.
 *   - Response must be an image content-type.
 *   - Hard cap on response size (2 MB).
 *   - Short fetch timeout (5 s).
 *   - Result cached for 1 hour via Cache-Control on the response.
 */
import { NextRequest, NextResponse } from 'next/server';
import dns from 'dns/promises';
import net from 'net';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FETCH_TIMEOUT_MS = 5_000;
const MAX_IMAGE_BYTES  = 2 * 1024 * 1024; // 2 MB

function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd');
}

const TRUSTED_HOSTNAMES = ['storyvenue.com', 'app.storyvenue.com'];

async function isSafeUrl(u: URL): Promise<boolean> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const hostname = u.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
  // Always allow our own domain — Railway's internal DNS resolves storyvenue.com
  // subdomains to private IPs, which would otherwise trip the SSRF guard.
  if (TRUSTED_HOSTNAMES.includes(hostname) || hostname.endsWith('.storyvenue.com')) return true;
  if (net.isIP(hostname)) return !isPrivateIp(hostname);
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    return addrs.every(a => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url')?.trim();
  if (!raw) return new NextResponse('url required', { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return new NextResponse('invalid url', { status: 400 });
  }

  if (!(await isSafeUrl(parsed))) {
    return new NextResponse('blocked', { status: 403 });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const upstream = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StoryVenueLinkPreview/1.0; +https://storyvenue.com)',
        Accept: 'image/*,*/*;q=0.8',
      },
    }).finally(() => clearTimeout(timer));

    if (!upstream.ok) {
      return new NextResponse('upstream error', { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return new NextResponse('not an image', { status: 422 });
    }

    // Stream up to MAX_IMAGE_BYTES into a buffer.
    const reader = upstream.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (total < MAX_IMAGE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
      }
      void reader.cancel().catch(() => {});
    }
    const body = Buffer.concat(chunks.map(c => Buffer.from(c)));

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type':  contentType,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse('fetch failed', { status: 502 });
  }
}
