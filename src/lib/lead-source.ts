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
 * dashboard funnel and per-contact badge stay simple to read. Accuracy is only
 * as good as the tags on the links people click — untagged traffic that really
 * came from an ad lands in "Direct".
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

export interface LeadSourceInput {
  /** first_touch_utm jsonb: { utm_source, utm_medium, utm_campaign, ... } */
  first_touch_utm?: Record<string, unknown> | null;
  /** ingest `source` column (e.g. 'directory', 'import', 'manual', 'ghl'). */
  source?: string | null;
  /** legacy manual referral_source free text (fallback signal only). */
  referral_source?: string | null;
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

  // ── Direct — no meaningful source signal at all ───────────────────────
  // A bare listing visit (source='directory') with no UTM and no referral is
  // treated as Direct: someone opened the link with no tracking tag on it.
  const hasSignal = Boolean(utmSource) || Boolean(ref);
  if (!hasSignal) return 'direct';

  // ── Other — a known source that isn't Meta or Google ──────────────────
  return 'other';
}
