/**
 * GET /api/link-preview?url=<encoded>
 *
 * Lightweight Open Graph unfurler for the support inbox's `LinkPreviewCard`.
 * Fetches basic OG metadata (title, description, image) for a message URL so
 * the thread can render a small preview card instead of a raw link.
 *
 * Deliberately simple:
 *   - Admin and support sign-in only (the support inbox is its only user).
 *   - Short fetch timeout (4s) so a slow/unreachable site never stalls the
 *     thread view — falls back to `{ ok: false }` (frontend renders a plain
 *     clickable link).
 *   - In-memory cache (1h TTL, at most CACHE_MAX entries, oldest dropped
 *     first) — good enough since the frontend also caches per-session.
 *   - Every hop, redirects included, must reach a public address
 *     (lib/safe-outbound-fetch), so a message body can't use this route to
 *     reach internal services.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { safeFetch } from '@/lib/safe-outbound-fetch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FETCH_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
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

// Map keeps insertion order, so the first key is the oldest entry.
const cache = new Map<string, CacheEntry>();

function remember(key: string, data: PreviewResult): void {
  cache.delete(key);
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
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
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

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

  try {
    const res = await safeFetch(parsed.toString(), {
      accept: 'text/html,application/xhtml+xml',
      maxBytes: MAX_HTML_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`status ${res.status}`);
    if (!res.contentType.includes('text/html')) throw new Error('not html');

    // OG tags are always in <head>, near the top; the read is capped.
    const html = res.body.toString('utf-8');
    const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
    const title = extractMeta(html, 'og:title') || (titleTag ? decodeEntities(titleTag) : null);
    const description = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    let image = extractMeta(html, 'og:image');
    if (image && !/^https?:\/\//i.test(image)) {
      try { image = new URL(image, res.finalUrl).toString(); } catch { image = null; }
    }

    const result: PreviewResult = { ok: true, url: raw, title, description, image };
    remember(raw, result);
    return NextResponse.json(result);
  } catch {
    // Failures are cached too, so a broken link isn't re-fetched on every render.
    const result: PreviewResult = { ok: false };
    remember(raw, result);
    return NextResponse.json(result);
  }
}
