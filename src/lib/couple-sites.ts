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
  show_countdown: boolean;
  show_venue: boolean;
  show_guestbook: boolean;
  show_registry: boolean;
  guestbook_moderated: boolean;
  created_at: string;
  updated_at: string;
}

export const COUPLE_SITE_COLUMNS =
  'id, couple_id, slug, is_published, headline, partner_name, story, photo_url, cover_url, custom_links, show_countdown, show_venue, show_guestbook, show_registry, guestbook_moderated, created_at, updated_at';

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

/** Only links that have both a label and a real outbound http(s) URL. */
export function publicCoupleSiteLinks(links: CoupleSiteLink[] | null | undefined): CoupleSiteLink[] {
  return (Array.isArray(links) ? links : [])
    .filter((l) => l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url.trim()) && String(l.label ?? '').trim().length > 0)
    .slice(0, COUPLE_SITE_MAX_LINKS);
}

/** "Jenny & Mike" from the bride's first name + partner name (best effort). */
export function coupleDisplayName(
  profile: { first_name?: string | null; display_name?: string | null } | null,
  partnerName: string | null | undefined,
): string {
  const bride = (profile?.first_name || profile?.display_name || '').trim();
  const partner = (partnerName || '').trim();
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
