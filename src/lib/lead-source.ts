/**
 * Canonical lead-source attribution.
 *
 * Every lead is bucketed into exactly one of four traffic sources purely from
 * data captured at the moment they came in — their first-touch UTM parameters,
 * the ingest `source` field, and (as a historical fallback) the legacy manual
 * `referral_source` text. This is a pure, deterministic function of immutable
 * first-touch data, so the resulting bucket is static and cannot be edited
 * after the fact — which is what keeps the funnel reporting trustworthy.
 *
 *   • meta   — Facebook / Instagram (organic or paid) via Meta
 *   • google — Google search (organic results or Google Ads — indistinguishable
 *              unless the paid links are specifically tagged)
 *   • direct — no source signal at all (link pasted/typed with no tracking tag)
 *   • other  — a known source that isn't Meta or Google (The Knot, WeddingWire,
 *              a referral, the venue's own website, etc.)
 *
 * Buckets are intentionally coarse (Meta / Google / Direct / Other) so the
 * dashboard funnel and per-contact badge stay simple to read.
 *
 * Two layers of signal, most precise first:
 *   1. First-touch UTM tags (or legacy manual referral text) — used when present.
 *   2. Browser referrer host fallback (facebook.com, instagram.com, google.*,
 *      etc.) — captured automatically on every click with zero setup, so even
 *      untagged ad/search traffic gets attributed instead of dumping into
 *      "Direct". Stored as `referrer` inside the first_touch_utm jsonb.
 * Only genuinely source-less visits (no tag, no external referrer) land in
 * "Direct". The referrer can't distinguish paid vs. organic within a platform,
 * but for these four buckets that distinction doesn't matter.
 */

export type LeadSourceBucket = 'meta' | 'google' | 'direct' | 'other';

export const LEAD_SOURCE_ORDER: LeadSourceBucket[] = ['meta', 'google', 'direct', 'other'];

export const LEAD_SOURCE_LABELS: Record<LeadSourceBucket, string> = {
  meta: 'Meta',
  google: 'Google',
  direct: 'Direct',
  other: 'Other',
};

/** utm_source / referral tokens that map to Meta (Facebook + Instagram). */
const META_TOKENS = new Set([
  'meta', 'facebook', 'fb', 'facebook_ads', 'facebookads', 'fb_ads',
  'instagram', 'ig', 'insta', 'fbig', 'meta_ads', 'metaads',
]);

/** utm_source / referral tokens that map to Google (search — organic or ads). */
const GOOGLE_TOKENS = new Set([
  'google', 'google_ads', 'googleads', 'google-ads', 'gads', 'adwords',
  'google_search', 'googlesearch', 'gsearch', 'google_business', 'gmb',
]);

function norm(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Extract a lowercased hostname from a referrer URL string. Empty on failure. */
function referrerHost(value: unknown): string {
  const raw = norm(value);
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    // Not a full URL — treat the raw value as a bare host if it looks like one.
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw) ? raw : '';
  }
}

/** Our own domains — an internal referrer tells us nothing about origin. */
function isInternalHost(host: string): boolean {
  return (
    host.includes('storyvenue') ||
    host.includes('storypay') ||
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.startsWith('192.168.')
  );
}

/**
 * Classify a referrer hostname into a bucket, or null when it carries no useful
 * signal (empty or one of our own domains).
 */
function bucketFromReferrer(host: string): LeadSourceBucket | null {
  if (!host || isInternalHost(host)) return null;
  if (/(^|\.)(facebook|instagram)\.com$/.test(host) || host.includes('facebook') || host.includes('instagram') || host === 'fb.com' || host === 'fb.me' || host === 'ig.me') {
    return 'meta';
  }
  if (/(^|\.)google\./.test(host)) return 'google';
  // A real external site we don't specifically recognize → Other, not Direct.
  return 'other';
}

export interface LeadSourceInput {
  /** first_touch_utm jsonb: { utm_source, utm_medium, utm_campaign, referrer, fbclid, ... } */
  first_touch_utm?: Record<string, unknown> | null;
  /** ingest `source` column (e.g. 'directory', 'import', 'manual', 'ghl'). */
  source?: string | null;
  /** legacy manual referral_source free text (fallback signal only). */
  referral_source?: string | null;
}

/**
 * Returns true when the first-touch data proves the visit came from a paid
 * Meta ad — i.e. an fbclid was present on the URL (Meta auto-appends this on
 * every ad click, organic posts do not get it).
 */
export function isMetaPaidAd(input: LeadSourceInput): boolean {
  const utm = (input.first_touch_utm && typeof input.first_touch_utm === 'object')
    ? (input.first_touch_utm as Record<string, unknown>)
    : {};
  return Boolean(norm(utm.fbclid));
}

/**
 * Bucket a lead into one of the four canonical traffic sources. Deterministic
 * and side-effect free.
 */
export function bucketLeadSource(input: LeadSourceInput): LeadSourceBucket {
  const utm = (input.first_touch_utm && typeof input.first_touch_utm === 'object')
    ? (input.first_touch_utm as Record<string, unknown>)
    : {};

  const utmSource = norm(utm.utm_source);
  const utmMedium = norm(utm.utm_medium);
  const utmCampaign = norm(utm.utm_campaign);
  const ref = norm(input.referral_source);

  // fbclid is auto-appended by Meta on every paid ad click with zero setup.
  // Its presence is a definitive signal that the visit came from a paid Meta ad.
  if (norm(utm.fbclid)) return 'meta';

  // Combined haystack for loose substring checks (medium/campaign often carry
  // "paid_social", "facebook", etc. even when utm_source is generic).
  const hay = `${utmSource} ${utmMedium} ${utmCampaign} ${ref}`;

  // ── Meta ──────────────────────────────────────────────────────────────
  if (
    META_TOKENS.has(utmSource) ||
    META_TOKENS.has(ref) ||
    /\b(facebook|instagram|meta)\b/.test(hay) ||
    hay.includes('paid_social')
  ) {
    return 'meta';
  }

  // ── Google (search) ───────────────────────────────────────────────────
  if (
    GOOGLE_TOKENS.has(utmSource) ||
    GOOGLE_TOKENS.has(ref) ||
    /\b(google|adwords)\b/.test(`${utmSource} ${utmMedium} ${utmCampaign}`) ||
    ref === 'google search'
  ) {
    return 'google';
  }

  // ── Known tag/referral that isn't Meta or Google → Other ──────────────
  const hasTagSignal = Boolean(utmSource) || Boolean(ref);
  if (hasTagSignal) return 'other';

  // ── Referrer fallback (no tag at all) ─────────────────────────────────
  // Captured automatically by the browser, so untagged ad/search traffic
  // still gets attributed instead of collapsing into Direct.
  const fromReferrer = bucketFromReferrer(referrerHost(utm.referrer));
  if (fromReferrer) return fromReferrer;

  // ── Direct — truly no source signal (no tag, no external referrer) ────
  return 'direct';
}
