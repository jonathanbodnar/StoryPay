/**
 * AI Concierge — A2P 10DLC verification helper.
 *
 * Pulls the venue's A2P brand + campaign registration status from GoHighLevel
 * and caches it on the venue row. When both the brand AND campaign report
 * "approved" / "verified" status we auto-set `venues.a2p_verified=TRUE`,
 * unblocking the AI Concierge eligibility CHECK. When either is missing or
 * not approved, we DO NOT touch `a2p_verified` — super admins retain a
 * manual override, which is critical for two scenarios:
 *
 *   1. Venues whose A2P registration was completed before we added the cache,
 *      where the GHL API may not return the historical brand/campaign IDs.
 *   2. Venues using a non-GHL SMS provider in the future (the abstraction in
 *      `sms-provider/` is already there) where `sms_provider !== 'ghl'`.
 *
 * The fetch is best-effort. If GHL's A2P endpoints return 404 (the location
 * has never registered) or 401 (token expired), we record the failure in
 * `a2p_last_check_error` and leave the previously cached status alone. This
 * keeps the auto-verify "additive" — it can promote a venue to verified, but
 * it can never demote one mid-session if the GHL API is having a bad day.
 *
 * The exception: if we successfully fetch the registration AND it shows the
 * brand or campaign as REJECTED / FAILED / SUSPENDED, we DO demote. That's
 * the whole point of the automation — auto-disable AI for venues whose A2P
 * registration was revoked.
 *
 * Supported GHL endpoint shapes (we probe in order, taking the first 200):
 *   - GET /phone-system/messaging-services/{locationId}   (most current)
 *   - GET /locations/{locationId}                         (legacy fallback;
 *                                                          look for an
 *                                                          a2p / smsRegistration
 *                                                          field)
 *
 * If GHL eventually publishes a v2 A2P endpoint we add it to the probe list.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { getGhlToken, getGhlAgencyKey, resolveLocationToken } from '@/lib/ghl';

const GHL_API_BASE = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';

// ── Types ────────────────────────────────────────────────────────────────

export type A2pStatus =
  | 'unknown'
  | 'not_registered'
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'failed';

export interface A2pSnapshot {
  brandId:           string | null;
  brandStatus:       A2pStatus;
  campaignId:        string | null;
  campaignStatus:    A2pStatus;
  /** True if both brand AND campaign are approved. */
  verified:          boolean;
  /** Last time we successfully reached GHL (or null if we never have). */
  lastCheckedAt:     string | null;
  /** Last error message from GHL, if the most recent fetch failed. */
  lastCheckError:    string | null;
  /** The actual decision made by `refreshVenueA2pStatus` for the audit log. */
  decision:          'auto_verified' | 'auto_revoked' | 'no_change' | 'fetch_failed';
}

interface VenueRow {
  id:                    string;
  name:                  string | null;
  ghl_location_id:       string | null;
  ghl_access_token:      string | null;
  sms_provider:          string | null;
  a2p_verified:          boolean | null;
  a2p_brand_id:          string | null;
  a2p_brand_status:      string | null;
  a2p_campaign_id:       string | null;
  a2p_campaign_status:   string | null;
  a2p_last_checked_at:   string | null;
  a2p_last_check_error:  string | null;
}

// ── Status normalizer ─────────────────────────────────────────────────────

const APPROVED_TOKENS  = new Set(['approved', 'verified', 'active', 'completed', 'registered', 'success']);
const REJECTED_TOKENS  = new Set(['rejected', 'failed', 'denied', 'declined']);
const SUSPENDED_TOKENS = new Set(['suspended', 'paused', 'expired', 'revoked']);
const PENDING_TOKENS   = new Set(['pending', 'in_progress', 'submitted', 'queued']);
const REVIEW_TOKENS    = new Set(['in_review', 'review', 'under_review', 'awaiting_review']);

/**
 * Normalize whatever string GHL hands us into our internal A2pStatus enum.
 * GHL has been known to return PascalCase, snake_case, and SHOUTING_CASE
 * across endpoints — we normalize aggressively.
 */
function normalizeStatus(raw: unknown): A2pStatus {
  if (typeof raw !== 'string' || !raw.trim()) return 'unknown';
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (APPROVED_TOKENS.has(s))  return 'approved';
  if (REJECTED_TOKENS.has(s))  return 'rejected';
  if (SUSPENDED_TOKENS.has(s)) return 'suspended';
  if (REVIEW_TOKENS.has(s))    return 'in_review';
  if (PENDING_TOKENS.has(s))   return 'pending';
  if (s.includes('not_registered') || s.includes('none')) return 'not_registered';
  return 'unknown';
}

/**
 * Combine brand + campaign status into the single boolean that gates AI.
 * Verified iff BOTH are 'approved'. A campaign without a brand can't send.
 */
export function isA2pApproved(brand: A2pStatus, campaign: A2pStatus): boolean {
  return brand === 'approved' && campaign === 'approved';
}

// ── GHL fetcher ───────────────────────────────────────────────────────────

interface RawA2pResult {
  brandId:        string | null;
  brandStatus:    A2pStatus;
  campaignId:     string | null;
  campaignStatus: A2pStatus;
  source:         string; // which endpoint succeeded, for diagnostics
}

/**
 * Probe GHL A2P endpoints. Returns the first successful response or throws.
 * Endpoints differ by GHL plan tier — we try the modern `/phone-system/`
 * path first, then fall back to the location-info endpoint.
 */
async function fetchGhlA2pRaw(opts: {
  accessToken: string;
  locationId:  string;
}): Promise<RawA2pResult> {
  const { accessToken, locationId } = opts;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
    'X-Location-Id': locationId,
  };

  // Endpoint 1: dedicated A2P / messaging-services endpoint.
  // Shape (when present):
  //   { brandId, brandStatus, campaignId, campaignStatus, ... }
  // GHL paths drift across plan tiers, so we try the two most-cited variants.
  const probes = [
    `${GHL_API_BASE}/phone-system/messaging-services/${encodeURIComponent(locationId)}/a2p`,
    `${GHL_API_BASE}/phone-system/messaging-services/${encodeURIComponent(locationId)}`,
  ];

  let lastErrText = 'No A2P endpoint returned a usable response';
  for (const url of probes) {
    try {
      const res = await fetch(url, { headers, method: 'GET' });
      if (res.status === 404) {
        lastErrText = `GHL ${url} returned 404 (no A2P registration on file)`;
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        lastErrText = `GHL ${url} responded ${res.status}: ${txt.slice(0, 200)}`;
        continue;
      }
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!json) {
        lastErrText = `GHL ${url} returned empty body`;
        continue;
      }

      const flat = flattenA2pResponse(json);
      if (flat.brandId || flat.brandStatus !== 'unknown' || flat.campaignId || flat.campaignStatus !== 'unknown') {
        return { ...flat, source: url };
      }
      lastErrText = `GHL ${url} returned 200 but no recognizable A2P fields`;
    } catch (e) {
      lastErrText = `GHL ${url} request failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Endpoint 2: location info — older plans expose A2P fields nested here.
  try {
    const url = `${GHL_API_BASE}/locations/${encodeURIComponent(locationId)}`;
    const res = await fetch(url, { headers, method: 'GET' });
    if (res.ok) {
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (json) {
        const flat = flattenA2pResponse(json);
        if (flat.brandId || flat.brandStatus !== 'unknown' || flat.campaignId || flat.campaignStatus !== 'unknown') {
          return { ...flat, source: url };
        }
      }
    } else {
      const txt = await res.text().catch(() => '');
      lastErrText = `GHL /locations/${locationId} responded ${res.status}: ${txt.slice(0, 200)}`;
    }
  } catch (e) {
    lastErrText = `GHL /locations request failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  throw new Error(lastErrText);
}

/**
 * GHL nests the A2P fields differently across endpoints. This walker
 * extracts the four fields we care about regardless of which shape arrived.
 *
 * Recognized shapes (any of):
 *   { brandId, brandStatus, campaignId, campaignStatus }
 *   { brand: { id, status }, campaign: { id, status } }
 *   { a2p: { brand: {...}, campaign: {...} } }
 *   { smsRegistration: { brandId, brandStatus, ... } }
 *   { messagingProfile: { ... } }
 */
function flattenA2pResponse(json: Record<string, unknown>): {
  brandId:        string | null;
  brandStatus:    A2pStatus;
  campaignId:     string | null;
  campaignStatus: A2pStatus;
} {
  // Try direct keys first.
  const directBrandId   = pickString(json, ['brandId', 'a2pBrandId', 'tcrBrandId']);
  const directBrandSt   = pickString(json, ['brandStatus', 'a2pBrandStatus', 'tcrBrandStatus']);
  const directCampId    = pickString(json, ['campaignId', 'a2pCampaignId', 'tcrCampaignId']);
  const directCampSt    = pickString(json, ['campaignStatus', 'a2pCampaignStatus', 'tcrCampaignStatus']);

  // Try nested objects.
  const containerKeys = ['a2p', 'smsRegistration', 'messagingProfile', 'tenDlc', 'tendlc'];
  for (const key of containerKeys) {
    const sub = json[key];
    if (sub && typeof sub === 'object') {
      const flat = flattenA2pResponse(sub as Record<string, unknown>);
      if (flat.brandId || flat.brandStatus !== 'unknown' || flat.campaignId || flat.campaignStatus !== 'unknown') {
        return {
          brandId:        directBrandId   ?? flat.brandId,
          brandStatus:    directBrandSt ? normalizeStatus(directBrandSt) : flat.brandStatus,
          campaignId:     directCampId    ?? flat.campaignId,
          campaignStatus: directCampSt ? normalizeStatus(directCampSt) : flat.campaignStatus,
        };
      }
    }
  }

  // Try { brand: {...}, campaign: {...} }
  const brand    = (json as { brand?: unknown }).brand;
  const campaign = (json as { campaign?: unknown }).campaign;
  let nestedBrandId:   string | null = null;
  let nestedBrandSt:   A2pStatus     = 'unknown';
  let nestedCampId:    string | null = null;
  let nestedCampSt:    A2pStatus     = 'unknown';
  if (brand && typeof brand === 'object') {
    nestedBrandId = pickString(brand as Record<string, unknown>, ['id', 'brandId', 'tcrBrandId']);
    nestedBrandSt = normalizeStatus(pickString(brand as Record<string, unknown>, ['status', 'state']));
  }
  if (campaign && typeof campaign === 'object') {
    nestedCampId = pickString(campaign as Record<string, unknown>, ['id', 'campaignId', 'tcrCampaignId']);
    nestedCampSt = normalizeStatus(pickString(campaign as Record<string, unknown>, ['status', 'state']));
  }

  return {
    brandId:        directBrandId   ?? nestedBrandId,
    brandStatus:    directBrandSt ? normalizeStatus(directBrandSt) : nestedBrandSt,
    campaignId:     directCampId    ?? nestedCampId,
    campaignStatus: directCampSt ? normalizeStatus(directCampSt) : nestedCampSt,
  };
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

// ── Diagnostic mode ───────────────────────────────────────────────────────

export interface A2pProbeAttempt {
  url:        string;
  status:     number | null;
  ok:         boolean;
  /** First 1000 chars of the response body (parsed when JSON, raw when text). */
  bodyPreview: string;
  /** Set when fetch itself failed (network, timeout). */
  error:      string | null;
  /** Recognized A2P fields we extracted from this response, if any. */
  extracted:  {
    brandId:        string | null;
    brandStatus:    A2pStatus;
    campaignId:     string | null;
    campaignStatus: A2pStatus;
  } | null;
}

export interface A2pDiagnosticReport {
  venueId:         string;
  venueName:       string | null;
  smsProvider:     string;
  ghlConnected:    boolean;
  hasAccessToken:  boolean;
  attempts:        A2pProbeAttempt[];
  /** Best-recognized values across all attempts, if anything matched. */
  bestExtracted:   A2pProbeAttempt['extracted'];
  /** Final verdict if we were going to persist (without persisting). */
  wouldVerify:     boolean;
  /** Diagnostic-only error (eg "no GHL token"). */
  bootstrapError:  string | null;
}

/**
 * Diagnose mode — call all GHL A2P probes and return the raw responses
 * for each attempt. NEVER persists. Use from the super-admin UI to
 * troubleshoot why a venue's A2P refresh is failing or returning unexpected
 * statuses.
 */
export async function diagnoseVenueA2pStatus(venueId: string): Promise<A2pDiagnosticReport> {
  const venue = await loadVenue(venueId);
  if (!venue) {
    throw new Error(`Venue not found: ${venueId}`);
  }

  const provider     = venue.sms_provider ?? 'ghl';
  const ghlConnected = !!venue.ghl_location_id;
  const accessToken  = ghlConnected ? getGhlToken({ ghl_access_token: venue.ghl_access_token }) : null;

  const attempts: A2pProbeAttempt[] = [];
  let bootstrapError: string | null = null;

  if (provider !== 'ghl') {
    bootstrapError = `A2P diagnostic only implemented for sms_provider='ghl' (got '${provider}').`;
  } else if (!ghlConnected) {
    bootstrapError = 'Venue has no ghl_location_id — connect GHL before diagnosing A2P.';
  } else if (!accessToken) {
    bootstrapError = 'No GHL access token (per-venue OAuth or agency env var).';
  } else {
    // Same probe URLs as fetchGhlA2pRaw, but we collect all attempts instead
    // of bailing on the first success. That gives the operator full visibility.
    const probes = [
      `${GHL_API_BASE}/phone-system/messaging-services/${encodeURIComponent(venue.ghl_location_id!)}/a2p`,
      `${GHL_API_BASE}/phone-system/messaging-services/${encodeURIComponent(venue.ghl_location_id!)}`,
      `${GHL_API_BASE}/locations/${encodeURIComponent(venue.ghl_location_id!)}`,
    ];

    // Try with the primary token first. If all probes 401, retry with the
    // agency key (covers legacy clients with a stale per-venue token).
    const agencyKey = getGhlAgencyKey();
    // Pre-resolve agency keys to location-scoped tokens (needed for location-scoped endpoints).
    const resolvedPrimary = await resolveLocationToken(accessToken, venue.ghl_location_id!);
    let headers: Record<string, string> = {
      Authorization: `Bearer ${resolvedPrimary}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
      'X-Location-Id': venue.ghl_location_id!,
    };

    for (const url of probes) {
      attempts.push(await runProbe(url, headers));
    }

    // If every probe returned 401 and we have a different agency key, retry
    // with a freshly-resolved location-scoped token.
    const allAuthFailed = attempts.length > 0 && attempts.every(
      (a) => a.status === 401 || (a.error && /unauthor/i.test(a.error)),
    );
    if (allAuthFailed && agencyKey && agencyKey !== accessToken) {
      const resolvedAgency = await resolveLocationToken(agencyKey, venue.ghl_location_id!);
      attempts.push({
        url: '(info)',
        status: null,
        ok: true,
        bodyPreview: 'Primary token got 401 on all probes — retrying with agency key (location-scoped).',
        error: null,
        extracted: null,
      });
      headers = {
        Authorization: `Bearer ${resolvedAgency}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
        'X-Location-Id': venue.ghl_location_id!,
      };
      for (const url of probes) {
        attempts.push(await runProbe(url, headers));
      }
    }
  }

  // Pick the best-recognized result across all attempts.
  let bestExtracted: A2pProbeAttempt['extracted'] = null;
  for (const a of attempts) {
    if (a.extracted && (a.extracted.brandStatus !== 'unknown' || a.extracted.campaignStatus !== 'unknown')) {
      bestExtracted = a.extracted;
      break;
    }
  }

  const wouldVerify = !!bestExtracted
    && isA2pApproved(bestExtracted.brandStatus, bestExtracted.campaignStatus);

  return {
    venueId:        venue.id,
    venueName:      venue.name,
    smsProvider:    provider,
    ghlConnected,
    hasAccessToken: !!accessToken,
    attempts,
    bestExtracted,
    wouldVerify,
    bootstrapError,
  };
}

async function runProbe(url: string, headers: Record<string, string>): Promise<A2pProbeAttempt> {
  try {
    const res = await fetch(url, { headers, method: 'GET' });
    let bodyPreview = '';
    let json: Record<string, unknown> | null = null;
    try {
      const text = await res.text();
      bodyPreview = text.slice(0, 1000);
      try { json = JSON.parse(text); } catch { /* not JSON, keep text preview */ }
    } catch {
      bodyPreview = '(could not read body)';
    }

    let extracted: A2pProbeAttempt['extracted'] = null;
    if (json) {
      const f = flattenA2pResponse(json);
      if (f.brandId || f.brandStatus !== 'unknown' || f.campaignId || f.campaignStatus !== 'unknown') {
        extracted = f;
      }
    }

    return {
      url,
      status:      res.status,
      ok:          res.ok,
      bodyPreview,
      error:       null,
      extracted,
    };
  } catch (e) {
    return {
      url,
      status:      null,
      ok:          false,
      bodyPreview: '',
      error:       e instanceof Error ? e.message : String(e),
      extracted:   null,
    };
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Refresh the A2P verification cache for one venue. Best-effort.
 *
 * Behaviors:
 *   - If venue has no GHL location_id or sms_provider != 'ghl' → records
 *     "skipped" error, leaves a2p_verified untouched, returns decision='no_change'.
 *   - If GHL fetch fails → records the error in `a2p_last_check_error`,
 *     leaves all other A2P columns untouched, returns decision='fetch_failed'.
 *   - If GHL fetch succeeds AND brand+campaign approved AND a2p_verified=false →
 *     auto-set a2p_verified=true, returns decision='auto_verified'.
 *   - If GHL fetch succeeds AND brand or campaign is rejected/suspended/failed
 *     AND a2p_verified=true → auto-set a2p_verified=false. Note that this
 *     also automatically disables AI via the eligibility constraint, which
 *     is the whole point of the automation. We also clear ai_concierge_enabled.
 *     Returns decision='auto_revoked'.
 *   - Any other shape → cache the latest status, return decision='no_change'.
 */
export async function refreshVenueA2pStatus(venueId: string): Promise<A2pSnapshot> {
  const venue = await loadVenue(venueId);
  if (!venue) {
    throw new Error(`Venue not found: ${venueId}`);
  }

  // Provider gate.
  if (venue.sms_provider && venue.sms_provider !== 'ghl') {
    const err = `A2P auto-refresh only implemented for sms_provider='ghl' (got '${venue.sms_provider}').`;
    await persistError(venueId, err);
    return snapshotFromVenue(venue, { errorOverride: err, decision: 'no_change' });
  }

  if (!venue.ghl_location_id) {
    const err = 'Venue has no ghl_location_id — cannot fetch A2P status. Connect GHL first.';
    await persistError(venueId, err);
    return snapshotFromVenue(venue, { errorOverride: err, decision: 'no_change' });
  }

  const accessToken = getGhlToken({ ghl_access_token: venue.ghl_access_token });
  if (!accessToken) {
    const err = 'No GHL access token available (neither per-venue OAuth nor agency key).';
    await persistError(venueId, err);
    return snapshotFromVenue(venue, { errorOverride: err, decision: 'no_change' });
  }

  // Agency-level JWTs must be exchanged for a location-scoped token before
  // hitting location-scoped endpoints. Per-venue OAuth tokens pass through.
  const resolvedToken = await resolveLocationToken(accessToken, venue.ghl_location_id);

  let raw: RawA2pResult;
  try {
    raw = await fetchGhlA2pRaw({ accessToken: resolvedToken, locationId: venue.ghl_location_id });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    // 401 → stale per-venue token. Try agency key fallback for legacy clients.
    if (/\b401\b/.test(errMsg)) {
      const agencyKey = getGhlAgencyKey();
      if (agencyKey && agencyKey !== accessToken) {
        try {
          const agencyLocationToken = await resolveLocationToken(agencyKey, venue.ghl_location_id);
          raw = await fetchGhlA2pRaw({ accessToken: agencyLocationToken, locationId: venue.ghl_location_id });
        } catch {
          await persistError(venueId, errMsg);
          return snapshotFromVenue(venue, { errorOverride: errMsg, decision: 'fetch_failed' });
        }
      } else {
        await persistError(venueId, errMsg);
        return snapshotFromVenue(venue, { errorOverride: errMsg, decision: 'fetch_failed' });
      }
    } else {
      await persistError(venueId, errMsg);
      return snapshotFromVenue(venue, { errorOverride: errMsg, decision: 'fetch_failed' });
    }
  }

  // Successful fetch. Determine if we should flip a2p_verified.
  const verifiedNow = isA2pApproved(raw.brandStatus, raw.campaignStatus);
  const wasVerified = venue.a2p_verified === true;
  const isHardNo    = raw.brandStatus === 'rejected'  || raw.brandStatus === 'suspended'  || raw.brandStatus === 'failed'
                  ||  raw.campaignStatus === 'rejected' || raw.campaignStatus === 'suspended' || raw.campaignStatus === 'failed';

  let decision: A2pSnapshot['decision'] = 'no_change';
  let newVerified = wasVerified;
  let disableAiConcierge = false;
  if (verifiedNow && !wasVerified) {
    decision    = 'auto_verified';
    newVerified = true;
  } else if (isHardNo && wasVerified) {
    decision           = 'auto_revoked';
    newVerified        = false;
    disableAiConcierge = true;
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    a2p_brand_id:         raw.brandId,
    a2p_brand_status:     raw.brandStatus,
    a2p_campaign_id:      raw.campaignId,
    a2p_campaign_status:  raw.campaignStatus,
    a2p_last_checked_at:  nowIso,
    a2p_last_check_error: null,
  };
  if (newVerified !== wasVerified) {
    update.a2p_verified = newVerified;
    if (disableAiConcierge) {
      // Hard cut: A2P revoked while AI was on.
      update.ai_concierge_enabled = false;
    }
  }

  const { error } = await supabaseAdmin
    .from('venues')
    .update(update)
    .eq('id', venueId);
  if (error) throw new Error(`Failed to persist A2P snapshot: ${error.message}`);

  return {
    brandId:        raw.brandId,
    brandStatus:    raw.brandStatus,
    campaignId:     raw.campaignId,
    campaignStatus: raw.campaignStatus,
    verified:       newVerified,
    lastCheckedAt:  nowIso,
    lastCheckError: null,
    decision,
  };
}

// ── Internals ─────────────────────────────────────────────────────────────

async function loadVenue(venueId: string): Promise<VenueRow | null> {
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, ghl_location_id, ghl_access_token, sms_provider, a2p_verified, a2p_brand_id, a2p_brand_status, a2p_campaign_id, a2p_campaign_status, a2p_last_checked_at, a2p_last_check_error')
    .eq('id', venueId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load venue: ${error.message}`);
  return (data as VenueRow | null) ?? null;
}

async function persistError(venueId: string, errMsg: string): Promise<void> {
  await supabaseAdmin
    .from('venues')
    .update({
      a2p_last_checked_at:  new Date().toISOString(),
      a2p_last_check_error: errMsg.slice(0, 500),
    })
    .eq('id', venueId);
}

function snapshotFromVenue(
  venue: VenueRow,
  opts:  { errorOverride?: string; decision: A2pSnapshot['decision'] },
): A2pSnapshot {
  return {
    brandId:        venue.a2p_brand_id,
    brandStatus:    normalizeStatus(venue.a2p_brand_status ?? null),
    campaignId:     venue.a2p_campaign_id,
    campaignStatus: normalizeStatus(venue.a2p_campaign_status ?? null),
    verified:       venue.a2p_verified === true,
    lastCheckedAt:  new Date().toISOString(),
    lastCheckError: opts.errorOverride ?? venue.a2p_last_check_error ?? null,
    decision:       opts.decision,
  };
}
