/**
 * Google Places API (New) — Place Details for reviews.
 * Requires GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY and Places API (New) enabled in Google Cloud.
 */

export type GooglePlaceReviewNormalized = {
  author_name: string;
  rating: number;
  text: string;
  published_at: string | null;
  profile_photo_url: string | null;
};

export type GoogleReviewsCachePayload = {
  rating: number | null;
  userRatingCount: number;
  reviews: GooglePlaceReviewNormalized[];
};

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,256}$/;

export function isValidGooglePlaceId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  return PLACE_ID_RE.test(id.trim());
}

function placesApiKey(): string | null {
  const k =
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  return k || null;
}

/**
 * Fetches place rating, total count, and up to `maxReviews` review texts from Places API (New).
 */
export async function fetchGooglePlaceReviews(
  placeId: string,
  maxReviews = 20,
): Promise<GoogleReviewsCachePayload | null> {
  const key = placesApiKey();
  const id = placeId.trim();
  if (!key || !isValidGooglePlaceId(id)) return null;

  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'rating,userRatingCount,reviews',
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn('[fetchGooglePlaceReviews]', res.status, errText.slice(0, 200));
    return null;
  }

  const data = (await res.json()) as Record<string, unknown>;
  const ratingRaw = data.rating;
  const rating =
    typeof ratingRaw === 'number' && !Number.isNaN(ratingRaw)
      ? Math.round(ratingRaw * 10) / 10
      : null;
  const userRatingCount =
    typeof data.userRatingCount === 'number' && !Number.isNaN(data.userRatingCount)
      ? data.userRatingCount
      : 0;

  const rawReviews = Array.isArray(data.reviews) ? data.reviews : [];
  const reviews: GooglePlaceReviewNormalized[] = [];

  for (const r of rawReviews.slice(0, maxReviews)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const textObj = o.text as { text?: string } | undefined;
    const text =
      typeof textObj?.text === 'string'
        ? textObj.text
        : typeof o.text === 'string'
          ? o.text
          : '';
    const author = o.authorAttribution as { displayName?: string; photoUri?: string } | undefined;
    const author_name = typeof author?.displayName === 'string' ? author.displayName.trim() : 'Google user';
    const ratingN = typeof o.rating === 'number' ? Math.min(5, Math.max(1, o.rating)) : 0;
    const publishTime = typeof o.publishTime === 'string' ? o.publishTime : null;
    const profile_photo_url =
      typeof author?.photoUri === 'string' && author.photoUri.startsWith('http') ? author.photoUri : null;

    if (!text.trim() && ratingN === 0) continue;

    reviews.push({
      author_name,
      rating: ratingN || 5,
      text: text.trim(),
      published_at: publishTime,
      profile_photo_url,
    });
  }

  return {
    rating,
    userRatingCount,
    reviews,
  };
}

const STALE_MS = 24 * 60 * 60 * 1000;

export function isGoogleReviewsCacheStale(fetchedAt: string | null | undefined): boolean {
  if (!fetchedAt) return true;
  const t = new Date(fetchedAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STALE_MS;
}
