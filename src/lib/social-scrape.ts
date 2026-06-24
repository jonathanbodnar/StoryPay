/**
 * Lightweight social-link scraper.
 *
 * Given a venue's website (e.g. the one Google has on file), fetch the
 * homepage HTML server-side and extract links to known social platforms.
 * No LLM needed — venues almost always link their socials in the header/footer,
 * so a simple href scan is faster, free, and more reliable than asking a model
 * to browse. Best-effort: any failure returns an empty result.
 *
 * Supported keys mirror the `social_links` shape used across the listing:
 * facebook, instagram, tiktok, pinterest.
 */

type SocialKey = 'facebook' | 'instagram' | 'tiktok' | 'pinterest';

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 1_500_000; // ~1.5MB of HTML is plenty for a homepage

// Per-platform: which hostnames count, and which paths to reject (share
// dialogs, individual posts, generic pages) so we land on a profile URL.
const MATCHERS: Record<SocialKey, { hosts: RegExp; rejectPath: RegExp }> = {
  facebook: {
    hosts: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i,
    rejectPath: /^\/(sharer|share|dialog|plugins|tr|login|help|policies|events|groups)\b/i,
  },
  instagram: {
    hosts: /(^|\.)instagram\.com$/i,
    rejectPath: /^\/(p|reel|reels|explore|stories|accounts|share)\b/i,
  },
  tiktok: {
    hosts: /(^|\.)tiktok\.com$/i,
    rejectPath: /^\/(video|tag|discover|foryou|share)\b/i,
  },
  pinterest: {
    hosts: /(^|\.)(pinterest\.com|pin\.it)$/i,
    rejectPath: /^\/(pin|search|ideas)\b/i,
  },
};

function normalizeUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith('//')) s = `https:${s}`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // Strip query/hash for a cleaner profile URL, keep trailing path.
    u.hash = '';
    u.search = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Pull every href-like URL out of the HTML (anchor hrefs first, then bare). */
function extractCandidateUrls(html: string): string[] {
  const out: string[] = [];
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) out.push(m[1]);
  // Also catch URLs embedded in JSON-LD / inline scripts.
  const bareRe = /https?:\/\/[^\s"'<>)]+/gi;
  const bare = html.match(bareRe);
  if (bare) out.push(...bare);
  return out;
}

export async function scanWebsiteForSocials(
  website: string,
): Promise<Partial<Record<SocialKey, string>>> {
  const start = normalizeUrl(website);
  if (!start) return {};

  // Guard against obviously-internal targets (defense-in-depth SSRF check).
  try {
    const host = new URL(start).hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return {};
    }
  } catch {
    return {};
  }

  let html = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(start, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StoryVenueBot/1.0)' },
      next: { revalidate: 0 },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return {};
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return {};
    const buf = await res.arrayBuffer();
    html = Buffer.from(buf.slice(0, MAX_BYTES)).toString('utf8');
  } catch {
    return {};
  }

  const found: Partial<Record<SocialKey, string>> = {};
  const candidates = extractCandidateUrls(html);

  for (const raw of candidates) {
    const norm = normalizeUrl(raw);
    if (!norm) continue;
    let parsed: URL;
    try {
      parsed = new URL(norm);
    } catch {
      continue;
    }
    for (const key of Object.keys(MATCHERS) as SocialKey[]) {
      if (found[key]) continue; // first profile match wins
      const { hosts, rejectPath } = MATCHERS[key];
      if (!hosts.test(parsed.hostname)) continue;
      // Must point at a profile, not the bare domain or a share/post path.
      if (parsed.pathname === '' || parsed.pathname === '/') continue;
      if (rejectPath.test(parsed.pathname)) continue;
      found[key] = norm;
    }
    if (Object.keys(found).length === Object.keys(MATCHERS).length) break;
  }

  return found;
}
