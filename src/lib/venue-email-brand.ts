/**
 * Venue branding for email a venue sends its own clients (couples / leads):
 * invoices, proposals, receipts, payment notices, the signed-contract copy,
 * guide delivery, tour confirmations. Those show the VENUE's logo at the top,
 * never StoryVenue's, so the couple knows who it's from. No usable logo → the
 * venue's name as a text logo (see buildSystemEmail's `venueBrand`).
 *
 * A logo is checked once (cached in memory) before it's used:
 *  - PNG, JPEG or GIF only. Gmail and Outlook don't show SVG; Outlook doesn't
 *    show WebP.
 *  - Its real size, so the email can set width/height. Outlook ignores CSS
 *    sizing and would draw a 3000px upload at full size.
 *  - Not white-on-transparent, which would vanish on the white email card.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { safeFetch } from '@/lib/safe-outbound-fetch';

export interface VenueEmailBrand {
  name: string;
  /** Only set when the logo will show in every email app. */
  logo: { url: string; width: number; height: number } | null;
}

// The logo box at the top of the email, in px: wide logos fill the width,
// square and tall ones the height.
const LOGO_MAX_W = 200;
const LOGO_MAX_H = 64;
// Share of the logo (on white) that must be visibly darker than white.
const MIN_VISIBLE_SHARE = 0.015;

type LogoCheck = { ok: true; width: number; height: number } | { ok: false };

const OK_TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000; // a failed download retries soon
const MAX_CACHED = 500;
const checked = new Map<string, { at: number; result: LogoCheck }>();
const inflight = new Map<string, Promise<LogoCheck>>();

async function checkLogo(url: string): Promise<LogoCheck> {
  try {
    const res = await safeFetch(url, { accept: 'image/*', maxBytes: 8 * 1024 * 1024, timeoutMs: 5000 });
    if (res.status !== 200 || res.truncated) return { ok: false };
    const sharp = (await import('sharp')).default;
    const meta = await sharp(res.body).metadata();
    if (!meta.format || !['png', 'jpeg', 'gif'].includes(meta.format)) return { ok: false };
    let w = meta.width ?? 0;
    let h = meta.height ?? 0;
    if ((meta.orientation ?? 1) >= 5) [w, h] = [h, w];
    if (!w || !h) return { ok: false };

    // Lay the logo on white and count the pixels dark enough to see.
    const { data, info } = await sharp(res.body)
      .flatten({ background: '#ffffff' })
      .resize(200, 200, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let visible = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] < 200) visible++;
    }
    if (visible / (info.width * info.height) < MIN_VISIBLE_SHARE) return { ok: false };

    const scale = Math.min(LOGO_MAX_W / w, LOGO_MAX_H / h, 1);
    return { ok: true, width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  } catch {
    return { ok: false };
  }
}

async function logoCheck(url: string): Promise<LogoCheck> {
  const hit = checked.get(url);
  if (hit && Date.now() - hit.at < (hit.result.ok ? OK_TTL_MS : FAIL_TTL_MS)) return hit.result;
  let pending = inflight.get(url);
  if (!pending) {
    pending = checkLogo(url).finally(() => inflight.delete(url));
    inflight.set(url, pending);
  }
  const result = await pending;
  if (checked.size >= MAX_CACHED) checked.delete(checked.keys().next().value as string);
  checked.set(url, { at: Date.now(), result });
  return result;
}

function absoluteUrl(raw: string | null | undefined): string | null {
  const u = (raw ?? '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '') + u;
  return null;
}

/** Email branding for a venue whose name and logo URL the caller already has. */
export async function resolveVenueEmailBrand(
  name: string | null | undefined,
  logoUrl: string | null | undefined,
): Promise<VenueEmailBrand> {
  const venueName = (name ?? '').trim() || 'Your Venue';
  const url = absoluteUrl(logoUrl);
  if (!url) return { name: venueName, logo: null };
  const check = await logoCheck(url);
  return { name: venueName, logo: check.ok ? { url, width: check.width, height: check.height } : null };
}

/** Load a venue's name and logo (branding page upload, else the older logo) and resolve its email branding. */
export async function loadVenueEmailBrand(venueId: string): Promise<VenueEmailBrand> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('name, brand_logo_url, logo_url')
    .eq('id', venueId)
    .maybeSingle();
  const v = (data ?? {}) as { name?: string | null; brand_logo_url?: string | null; logo_url?: string | null };
  return resolveVenueEmailBrand(v.name, v.brand_logo_url || v.logo_url);
}
