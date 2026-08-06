/**
 * GET /api/link-preview?url=<encoded>
 *
 * Lightweight Open Graph unfurler for the support inbox's `LinkPreviewCard`.
 * Fetches basic OG metadata (title, description, image) for a message URL so
 * the thread can render a small preview card instead of a raw link.
 *
 * Deliberately simple:
 *   - Short fetch timeout (4s) so a slow/unreachable site never stalls the
 *     thread view — falls back to `{ ok: false }` (frontend renders a plain
 *     clickable link).
 *   - In-memory cache (1h TTL) per server instance — good enough since the
 *     frontend also caches per-session; no DB table needed.
 *   - Basic SSRF guard: only http/https, and rejects hostnames that resolve
 *     to loopback/private/link-local ranges so a malicious message body can't
 *     use this route to probe internal infra.
 */
import { NextRequest, NextResponse } from 'next/server';
import dns from 'dns/promises';
import net from 'net';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FETCH_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_HTML_BYTES = 500 * 1024;

interface CacheEntry {
  data: PreviewResult;
  expiresAt: number;
}
interface PreviewResult {
  ok: boolean;
  url?: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
}

const cache = new Map<string, CacheEntry>();

function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  // IPv6 loopback / link-local / unique-local
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd');
}

async function isSafeUrl(u: URL): Promise<boolean> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const hostname = u.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
  if (net.isIP(hostname)) return !isPrivateIp(hostname);
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    return addrs.every(a => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractMeta(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return null;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url')?.trim();
  if (!raw) return NextResponse.json({ ok: false, error: 'url required' }, { status: 400 });

  const cached = cache.get(raw);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ ok: false });
  }

  const safe = await isSafeUrl(parsed);
  if (!safe) {
    const result: PreviewResult = { ok: false };
    cache.set(raw, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(result);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StoryVenueLinkPreview/1.0; +https://storyvenue.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) throw new Error(`status ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) throw new Error('not html');

    // Cap how much HTML we read — OG tags are always in <head>, near the top.
    const reader = res.body?.getReader();
    let html = '';
    if (reader) {
      let bytes = 0;
      while (bytes < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += Buffer.from(value).toString('utf-8');
        bytes += value.byteLength;
      }
      void reader.cancel().catch(() => {});
    } else {
      html = await res.text();
    }

    const title = extractMeta(html, 'og:title') || (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)![1]) : null);
    const description = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    let image = extractMeta(html, 'og:image');
    if (image && !/^https?:\/\//i.test(image)) {
      try { image = new URL(image, parsed).toString(); } catch { image = null; }
    }

    const result: PreviewResult = { ok: true, url: raw, title, description, image };
    cache.set(raw, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(result);
  } catch {
    const result: PreviewResult = { ok: false };
    // Cache failures too (shorter isn't worth the complexity — same TTL),
    // so a broken link doesn't get re-fetched on every render.
    cache.set(raw, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(result);
  }
}
