import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { LEAD_LINK_ICON_KEY_SET } from '@/lib/lead-link-icons';
import { slugify } from '@/lib/directory';

/**
 * Wedding Minisite ("couple_sites") server helpers.
 *
 * The bride authors her page while logged into StoryPay; it renders publicly at
 * storyvenue.com/<slug> (the weddingdirectory app) via the public read API in
 * src/app/api/public/minisite/[slug]. Keep this the single source of truth for
 * slug rules, link sanitising, and the public payload shape.
 */

export const COUPLE_SITE_MAX_LINKS = 6;
export const COUPLE_SITE_MAX_GALLERY = 9;

export type CoupleSiteLink = { label: string; url: string; icon: string };

export interface CoupleSiteRow {
  id: string;
  couple_id: string;
  slug: string | null;
  is_published: boolean;
  headline: string | null;
  partner_name: string | null;
  story: string | null;
  photo_url: string | null;
  cover_url: string | null;
  custom_links: CoupleSiteLink[] | null;
  gallery: string[] | null;
  embed_html: string | null;
  embed_enabled: boolean;
  embed_title: string | null;
  show_countdown: boolean;
  show_venue: boolean;
  show_guestbook: boolean;
  show_registry: boolean;
  guestbook_moderated: boolean;
  created_at: string;
  updated_at: string;
}

// NOTE: site_password_hash is deliberately NOT in this shared column list — it is
// fetched only where needed (public gate / unlock) so it never leaks to a client.
export const COUPLE_SITE_COLUMNS =
  'id, couple_id, slug, is_published, headline, partner_name, story, photo_url, cover_url, custom_links, gallery, embed_html, embed_enabled, embed_title, show_countdown, show_venue, show_guestbook, show_registry, guestbook_moderated, created_at, updated_at';

/**
 * Top-level paths already used by the weddingdirectory app (storyvenue.com) plus
 * common infra names. A couple slug can never be one of these, so the public
 * /<slug> route never shadows a real page.
 */
export const RESERVED_COUPLE_SLUGS: ReadonlySet<string> = new Set([
  'venue', 'venues', 'search', 'links', 'blog', 'jason',
  'bride-booking-system', 'strategy-call', 'free-listing', 'book-more-weddings',
  'confirmation', 'maintenance', 'privacy', 'terms', 'about', 'contact', 'pricing',
  'login', 'signup', 'signin', 'sign-up', 'sign-in', 'logout', 'register',
  'dashboard', 'admin', 'couple', 'rsvp', 'proposal', 'invoice', 'guide', 'embed',
  'u', 'availability', 'update-card', 'setup', 'suspended', 'offline',
  'api', '_next', 'static', 'assets', 'images', 'img', 'fonts', 'public',
  'favicon.ico', 'robots.txt', 'sitemap.xml', 'manifest.json',
  'w', 'wedding', 'weddings', 'app', 'help', 'support', 'account', 'settings',
]);

/** Normalize + validate a requested couple slug. Returns null if unusable. */
export function normalizeCoupleSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const slug = slugify(raw);
  if (slug.length < 3) return null;
  if (RESERVED_COUPLE_SLUGS.has(slug)) return null;
  return slug;
}

/** Up to COUPLE_SITE_MAX_LINKS rows of { label, url, icon }; unknown icons -> 'link'. */
export function sanitizeCoupleSiteLinks(raw: unknown): CoupleSiteLink[] {
  if (!Array.isArray(raw)) return [];
  const out: CoupleSiteLink[] = [];
  for (const row of raw.slice(0, COUPLE_SITE_MAX_LINKS)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { label?: unknown; url?: unknown; icon?: unknown };
    const label = String(r.label ?? '').trim().slice(0, 60);
    const url = String(r.url ?? '').trim().slice(0, 500);
    const iconRaw = String(r.icon ?? 'link').trim();
    const icon = LEAD_LINK_ICON_KEY_SET.has(iconRaw) ? iconRaw : 'link';
    out.push({ label, url, icon });
  }
  return out;
}

/** Up to COUPLE_SITE_MAX_GALLERY image URLs (must be http(s)); dedupes + trims. */
export function sanitizeGallery(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const url = item.trim().slice(0, 800);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= COUPLE_SITE_MAX_GALLERY) break;
  }
  return out;
}

/** Public gallery URLs (same rules; safe to expose). */
export function publicGallery(gallery: string[] | null | undefined): string[] {
  return sanitizeGallery(gallery);
}

/**
 * Accept pasted embed code and return a SINGLE, rebuilt <iframe> that can only
 * point at an https source with a controlled attribute set — no <script>, no
 * on* handlers, no srcdoc. Returns null if there is no usable https iframe.
 * The rendered wrapper supplies a responsive 16:9 box.
 */
const IFRAME_ALLOW_RE = /^[a-z0-9;()'"\-\s./:*=]+$/i;
export function sanitizeEmbedHtml(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const input = raw.trim();
  if (!input) return null;

  const srcMatch = input.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  const src = srcMatch?.[1]?.trim();
  if (!src || !/^https:\/\//i.test(src) || src.length > 800) return null;

  const allowMatch = input.match(/\sallow\s*=\s*["']([^"']*)["']/i);
  let allow = allowMatch?.[1]?.trim() ?? '';
  if (allow && !IFRAME_ALLOW_RE.test(allow)) allow = '';
  allow = allow.slice(0, 200);

  const allowFs = /allowfullscreen/i.test(input);
  const safeSrc = src.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');

  return (
    `<iframe src="${safeSrc}"` +
    (allow ? ` allow="${allow}"` : '') +
    (allowFs ? ' allowfullscreen' : '') +
    ' loading="lazy" referrerpolicy="strict-origin-when-cross-origin"' +
    ' style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe>'
  );
}

// ── Optional private password gate ─────────────────────────────────────────
const MINISITE_SECRET = process.env.LEAD_WEBHOOK_SECRET || '';

/** scrypt hash string: "scrypt$<saltHex>$<hashHex>". */
export function hashSitePassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifySitePassword(pw: string, stored: string | null | undefined): boolean {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = scryptSync(pw, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * A proof-of-unlock token bound to the slug + current password hash. Handed to
 * the browser (as a cookie by weddingdirectory) after a correct password, then
 * presented back to the public GET. Rotating the password invalidates old
 * tokens automatically because the hash changes.
 */
export function minisiteUnlockToken(slug: string, passwordHash: string): string {
  return createHmac('sha256', MINISITE_SECRET).update(`${slug}:${passwordHash}`).digest('hex');
}

/** Fetch just the password hash for a slug (server-only gate checks). */
export async function getCoupleSitePasswordHash(slug: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('couple_sites')
    .select('site_password_hash')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  return (data as { site_password_hash?: string | null } | null)?.site_password_hash ?? null;
}

/** Only links that have both a label and a real outbound http(s) URL. */
export function publicCoupleSiteLinks(links: CoupleSiteLink[] | null | undefined): CoupleSiteLink[] {
  return (Array.isArray(links) ? links : [])
    .filter((l) => l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url.trim()) && String(l.label ?? '').trim().length > 0)
    .slice(0, COUPLE_SITE_MAX_LINKS);
}

/**
 * "Jenny & Mike" from the bride's first name + partner name. Partner name is
 * sourced from the profile (partner_first_name) with the legacy
 * couple_sites.partner_name kept as a tolerant fallback for older data.
 */
export function coupleDisplayName(
  profile: { first_name?: string | null; display_name?: string | null; partner_first_name?: string | null } | null,
  partnerName: string | null | undefined,
): string {
  const bride = (profile?.first_name || profile?.display_name || '').trim();
  const partner = (profile?.partner_first_name || partnerName || '').trim();
  if (bride && partner) return `${bride} & ${partner}`;
  return bride || partner || 'Our Wedding';
}

/** Load a bride's site row (creates nothing). */
export async function getCoupleSiteByCoupleId(coupleId: string): Promise<CoupleSiteRow | null> {
  const { data } = await supabaseAdmin
    .from('couple_sites')
    .select(COUPLE_SITE_COLUMNS)
    .eq('couple_id', coupleId)
    .maybeSingle();
  return (data as CoupleSiteRow | null) ?? null;
}

/** True if a slug is taken by a DIFFERENT couple. */
export async function isCoupleSlugTaken(slug: string, exceptCoupleId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('couple_sites')
    .select('couple_id')
    .eq('slug', slug)
    .maybeSingle();
  const row = data as { couple_id: string } | null;
  return Boolean(row && row.couple_id !== exceptCoupleId);
}
