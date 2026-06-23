/**
 * Google Places API (New) — full Business Profile import.
 *
 * Extends the existing review-sync (see google-place-reviews.ts) to also pull
 * profile data: name, address, city/state, hours, description, rating, type,
 * website, phone, and photo references. Same server-side API key, no per-venue
 * OAuth — we just widen the field mask on the Place Details call we already make.
 */

export type GooglePlacePhotoRef = {
  name: string; // "places/PLACE_ID/photos/PHOTO_REF"
  widthPx?: number;
  heightPx?: number;
};

export type GooglePlaceProfile = {
  place_id: string;
  name: string;
  formatted_address: string;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  user_ratings_total: number | null;
  description: string | null; // editorialSummary
  hours: string[] | null; // regularOpeningHours.weekdayDescriptions
  website: string | null;
  phone: string | null;
  venue_type: string | null; // primaryTypeDisplayName
  photos: GooglePlacePhotoRef[];
};

function placesApiKey(): string | null {
  return (
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    null
  );
}

const PROFILE_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'addressComponents',
  'location',
  'rating',
  'userRatingCount',
  'editorialSummary',
  'regularOpeningHours',
  'websiteUri',
  'nationalPhoneNumber',
  'primaryTypeDisplayName',
  'photos',
].join(',');

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

function extractCityState(components: AddressComponent[] | undefined): {
  city: string | null;
  state: string | null;
} {
  let city: string | null = null;
  let state: string | null = null;
  for (const c of components ?? []) {
    const types = c.types ?? [];
    if (!city && (types.includes('locality') || types.includes('postal_town'))) {
      city = c.longText ?? c.shortText ?? null;
    }
    if (!state && types.includes('administrative_area_level_1')) {
      state = c.shortText ?? c.longText ?? null;
    }
  }
  return { city, state };
}

/**
 * Fetch the full Google Business Profile for a place. Returns null on any
 * failure (missing key, bad place id, Google error) so callers can fall back
 * gracefully to manual entry.
 */
export async function fetchGooglePlaceProfile(
  placeId: string,
): Promise<GooglePlaceProfile | null> {
  const key = placesApiKey();
  const id = placeId.trim();
  if (!key || !id) return null;

  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': PROFILE_FIELD_MASK,
      },
      next: { revalidate: 0 },
    });
  } catch (e) {
    console.warn('[fetchGooglePlaceProfile] fetch failed', e);
    return null;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn('[fetchGooglePlaceProfile]', res.status, errText.slice(0, 200));
    return null;
  }

  const d = (await res.json()) as Record<string, unknown>;

  const displayName = (d.displayName as { text?: string } | undefined)?.text ?? '';
  const loc = d.location as { latitude?: number; longitude?: number } | undefined;
  const editorial = (d.editorialSummary as { text?: string } | undefined)?.text ?? null;
  const hoursObj = d.regularOpeningHours as { weekdayDescriptions?: string[] } | undefined;
  const ratingRaw = d.rating;
  const { city, state } = extractCityState(d.addressComponents as AddressComponent[] | undefined);

  const photosRaw = Array.isArray(d.photos) ? (d.photos as Record<string, unknown>[]) : [];
  const photos: GooglePlacePhotoRef[] = photosRaw
    .map((p) => ({
      name: typeof p.name === 'string' ? p.name : '',
      widthPx: typeof p.widthPx === 'number' ? p.widthPx : undefined,
      heightPx: typeof p.heightPx === 'number' ? p.heightPx : undefined,
    }))
    .filter((p) => p.name);

  return {
    place_id: typeof d.id === 'string' ? d.id : id,
    name: displayName,
    formatted_address: typeof d.formattedAddress === 'string' ? d.formattedAddress : '',
    city,
    state,
    lat: typeof loc?.latitude === 'number' ? loc.latitude : null,
    lng: typeof loc?.longitude === 'number' ? loc.longitude : null,
    rating:
      typeof ratingRaw === 'number' && !Number.isNaN(ratingRaw)
        ? Math.round(ratingRaw * 10) / 10
        : null,
    user_ratings_total:
      typeof d.userRatingCount === 'number' ? d.userRatingCount : null,
    description: editorial,
    hours: Array.isArray(hoursObj?.weekdayDescriptions)
      ? hoursObj!.weekdayDescriptions!
      : null,
    website: typeof d.websiteUri === 'string' ? d.websiteUri : null,
    phone: typeof d.nationalPhoneNumber === 'string' ? d.nationalPhoneNumber : null,
    venue_type:
      (d.primaryTypeDisplayName as { text?: string } | undefined)?.text ?? null,
    photos,
  };
}

/**
 * Resolves a Place Photo resource name to a temporary public image URL.
 * Uses skipHttpRedirect so Google returns JSON ({ photoUri }) instead of a 302.
 * The returned URI is short-lived — callers should download + re-host it.
 */
export async function resolveGooglePhotoUri(
  photoName: string,
  maxWidthPx = 1600,
): Promise<string | null> {
  const key = placesApiKey();
  if (!key || !photoName) return null;

  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-Goog-Api-Key': key },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { photoUri?: string };
    return typeof j.photoUri === 'string' ? j.photoUri : null;
  } catch {
    return null;
  }
}
