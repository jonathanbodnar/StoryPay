/**
 * Venue coordinate resolution.
 *
 * The live visitor map (and anything else that needs to center on a venue)
 * relies on `venues.lat` / `venues.lng`. Those are populated when an owner
 * picks their address from the listing editor's autocomplete — but plenty of
 * venues were imported or set up with only a city/state (e.g. `location_city`
 * "Brazil", `location_state` "Indiana") and never got coordinates. Without them
 * the map falls back to a whole-continental-US view instead of the venue's
 * local ~100mi frame.
 *
 * This module derives coordinates from whatever location a venue DOES have,
 * using the same free Nominatim (OpenStreetMap) geocoder the listing editor's
 * address autocomplete already uses, and persists the result so every surface
 * (map, directory, etc.) stays consistent and we only geocode once per venue.
 */

import { supabaseAdmin } from '@/lib/supabase';

// Nominatim asks every caller to identify itself; mirrors the User-Agent used
// by the reverse-geocode path in /api/listing-track.
const NOMINATIM_UA = 'StoryVenueGeocoder/1.0 (app.storyvenue.com)';

export interface VenueLocationFields {
  location_full?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  brand_address?: string | null;
  brand_city?: string | null;
  brand_state?: string | null;
  brand_zip?: string | null;
}

const clean = (s?: string | null): string => (s && s.trim() ? s.trim() : '');

/**
 * Ordered list of geocoder queries for a venue, most specific first:
 *   1. full combined address  (street, city, state, zip)
 *   2. city + state           (centroid — always good enough for a ~100mi map)
 *   3. bare zip
 * We try them in order and stop at the first that resolves. Many rural venues
 * have a street address that isn't in the geocoder's index, so falling back to
 * a city/zip centroid keeps the map framed on the right area. Combining street
 * with city/state matters — "7831 N STATE ROAD 59" alone lands in the wrong
 * state, but "7831 N STATE ROAD 59, Brazil, Indiana" resolves correctly.
 */
export function buildVenueLocationCandidates(v: VenueLocationFields): string[] {
  const street = clean(v.location_full) || clean(v.address) || clean(v.brand_address);
  const city = clean(v.location_city) || clean(v.city) || clean(v.brand_city);
  const state = clean(v.location_state) || clean(v.state) || clean(v.brand_state);
  const zip = clean(v.zip) || clean(v.brand_zip);

  const alreadyHas = (part: string): boolean =>
    !!part && street.toLowerCase().includes(part.toLowerCase());

  const candidates: string[] = [];

  // 1. Full combined address.
  const parts: string[] = [];
  if (street) parts.push(street.replace(/,\s*$/, ''));
  if (city && !alreadyHas(city)) parts.push(city);
  if (state && !alreadyHas(state)) parts.push(state);
  let full = parts.join(', ').trim();
  if (zip && !full.includes(zip)) full = `${full} ${zip}`.trim();
  full = full.replace(/^,\s*/, '').trim();
  if (full) candidates.push(full);

  // 2. City + state centroid.
  const cityState = [city, state].filter(Boolean).join(', ').trim();
  if (cityState) candidates.push(cityState);

  // 3. Bare zip.
  if (zip) candidates.push(`${zip}, USA`);

  return [...new Set(candidates)];
}

/** First (most specific) candidate query, or null if the venue has no location. */
export function buildVenueLocationQuery(v: VenueLocationFields): string | null {
  return buildVenueLocationCandidates(v)[0] ?? null;
}

/**
 * Forward-geocode a US location string to coordinates via Nominatim.
 * `countrycodes=us` is important: it stops city names that collide with
 * countries (e.g. "Brazil, Indiana") from resolving to the wrong continent.
 */
export async function geocodeLocation(query: string): Promise<{ lat: number; lng: number } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`,
      { signal: controller.signal, headers: { 'User-Agent': NOMINATIM_UA }, cache: 'no-store' }
    );
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const first = arr?.[0];
    if (!first?.lat || !first?.lon) return null;
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null; // timeout / network — caller falls back to the US view
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Return a venue's coordinates, geocoding + persisting them on first use if
 * they're missing. Cheap steady state: once `lat`/`lng` are set this is a
 * single indexed read and zero network calls. Never throws — returns null only
 * when the venue truly has no geocodable location.
 */
export async function ensureVenueCoordinates(
  venueId: string
): Promise<{ lat: number; lng: number } | null> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select(
      'lat, lng, location_full, location_city, location_state, address, city, state, zip, brand_address, brand_city, brand_state, brand_zip'
    )
    .eq('id', venueId)
    .maybeSingle();
  if (!data) return null;

  const lat = data.lat != null ? Number(data.lat) : null;
  const lng = data.lng != null ? Number(data.lng) : null;
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  const candidates = buildVenueLocationCandidates(data as VenueLocationFields);
  if (candidates.length === 0) return null;

  let geo: { lat: number; lng: number } | null = null;
  for (const q of candidates) {
    geo = await geocodeLocation(q);
    if (geo) break;
  }
  if (!geo) return null;

  // Persist so the map, directory and every other surface stay consistent and
  // we only ever geocode a given venue once. Guarded on lat IS NULL so we never
  // clobber coordinates an owner set precisely via the address autocomplete.
  await supabaseAdmin
    .from('venues')
    .update({ lat: geo.lat, lng: geo.lng })
    .eq('id', venueId)
    .is('lat', null);

  return geo;
}
