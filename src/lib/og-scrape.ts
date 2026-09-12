/**
 * OpenGraph link preview — best-effort image + title for a pasted URL.
 *
 * Given an arbitrary URL (an Instagram post, a blog, a vendor page…), fetch it
 * server-side and pull out og:image / twitter:image and og:title / <title>. This
 * lets the inspiration board show a thumbnail for "other links" without hosting
 * anything. Any failure returns nulls (the caller falls back to a plain link).
 *
 * Reuses the SSRF-guard + capped/timed fetch approach from social-scrape.ts.
 */

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 1_500_000;

export interface LinkPreview {
  url: string;
  imageUrl: string | null;
  title: string | null;
  siteName: string | null;
}

function normalizeUrl(raw: string): string | null {
  let s = (raw ?? '').trim();
  if (!s) return null;
  if (s.startsWith('//')) s = `https:${s}`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Defense-in-depth SSRF check — reject internal / private targets. */
function isInternalHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|169\.254\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

function firstMatch(html: string, res: RegExp[]): string | null {
  for (const re of res) {
    const m = re.exec(html);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

/**
 * Meta-tag regexes tolerant to attribute order:
 *   <meta property="og:image" content="...">  and  <meta content="..." property="og:image">
 */
function metaRes(prop: string): RegExp[] {
  const p = prop.replace(/[:]/g, '\\:');
  return [
    new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, 'i'),
  ];
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  const url = normalizeUrl(rawUrl);
  const empty: LinkPreview = { url: url ?? '', imageUrl: null, title: null, siteName: null };
  if (!url) return empty;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return empty;
  }
  if (isInternalHost(parsed.hostname)) return empty;

  let html = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StoryVenueBot/1.0)' },
      next: { revalidate: 0 },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return empty;
    const ct = res.headers.get('content-type') ?? '';
    // If the URL is itself an image, use it directly.
    if (ct.startsWith('image/')) {
      return { url, imageUrl: url, title: null, siteName: parsed.hostname.replace(/^www\./, '') };
    }
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return empty;
    const buf = await res.arrayBuffer();
    html = Buffer.from(buf.slice(0, MAX_BYTES)).toString('utf8');
  } catch {
    return empty;
  }

  let imageUrl = firstMatch(html, [...metaRes('og:image'), ...metaRes('og:image:url'), ...metaRes('twitter:image')]);
  const title =
    firstMatch(html, [...metaRes('og:title'), ...metaRes('twitter:title')]) ??
    firstMatch(html, [/<title[^>]*>([^<]+)<\/title>/i]);
  const siteName = firstMatch(html, metaRes('og:site_name')) ?? parsed.hostname.replace(/^www\./, '');

  // Resolve a relative og:image against the page URL.
  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, url).toString();
    } catch {
      imageUrl = null;
    }
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) imageUrl = null;
  }

  return { url, imageUrl, title, siteName };
}
