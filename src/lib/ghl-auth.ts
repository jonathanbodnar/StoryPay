/**
 * Shared GHL authentication helpers used by every call site that needs a
 * working token for a venue's sub-account.
 *
 * The legacy GHL_AGENCY_API_KEY env var is a v1 Agency API Key. v1 contact /
 * conversation endpoints only accept LOCATION-scoped v1 keys, so for legacy
 * clients we bootstrap from agency → location once and cache the result in
 * `venues.ghl_access_token`.
 *
 * After the first call this is a no-op (the cached location key is used
 * directly).
 */

import { supabaseAdmin } from '@/lib/supabase';
import {
  getGhlToken,
  classifyToken,
  v1KeyMatchesLocation,
  fetchV1LocationApiKey,
} from '@/lib/ghl';

interface VenueAuth {
  id: string;
  ghl_location_id: string | null;
  ghl_access_token: string | null;
}

/**
 * Ensure we have a token that will work for location-scoped GHL API calls
 * against the given venue's sub-account.
 *
 * Steps:
 *   1. Pick the best available token (per-venue stored, else env agency key).
 *   2. If it's a v1 key not already scoped to this location, exchange it via
 *      `/v1/locations/{id}` for the location's v1 key. Cache that key on the
 *      venue row so future calls skip the lookup.
 *   3. For v2 OAuth / PIT, defer to `resolveLocationToken` at the call site.
 *
 * Returns the token string to pass to ghlRequest / sendSms / etc.
 *
 * Throws with a clear, actionable error message if no working token can be
 * obtained.
 */
export async function ensureLocationToken(venue: VenueAuth): Promise<string> {
  const locationId = venue.ghl_location_id;
  if (!locationId) {
    throw new Error('Venue has no GHL sub-account ID — set one in Settings → StoryVenue Legacy.');
  }

  const initial = getGhlToken({ ghl_access_token: venue.ghl_access_token });
  if (!initial) {
    throw new Error('No GHL token available (no per-venue token and no GHL_AGENCY_API_KEY env var).');
  }

  // v1 path: ensure we have a key scoped to THIS location.
  if (classifyToken(initial) === 'v1') {
    if (v1KeyMatchesLocation(initial, locationId)) return initial;

    // Need to bootstrap. Try with the env agency key (which usually has
    // /v1/locations/{id} read permission) rather than the per-venue token
    // which might already be a stale location key for a different location.
    const agencyKey = process.env.GHL_AGENCY_API_KEY || process.env.GHL_PRIVATE_KEY || initial;

    let locationKey: string;
    try {
      locationKey = await fetchV1LocationApiKey(agencyKey, locationId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Unable to obtain a v1 Location API key for sub-account ${locationId}. ${msg}`,
      );
    }

    await supabaseAdmin
      .from('venues')
      .update({ ghl_access_token: locationKey })
      .eq('id', venue.id);

    return locationKey;
  }

  // Non-v1 tokens (PIT or v2 OAuth) are handled at the call site via
  // resolveLocationToken; just return the raw token here.
  return initial;
}
