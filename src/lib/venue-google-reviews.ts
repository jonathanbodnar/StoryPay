import { supabaseAdmin } from '@/lib/supabase';
import {
  fetchGooglePlaceReviews,
  isValidGooglePlaceId,
  type GoogleReviewsCachePayload,
} from '@/lib/google-place-reviews';

export async function refreshVenueGoogleReviews(
  venueId: string,
  placeId: string,
): Promise<GoogleReviewsCachePayload | null> {
  const fresh = await fetchGooglePlaceReviews(placeId);
  if (!fresh) return null;
  const { error } = await supabaseAdmin
    .from('venues')
    .update({
      google_reviews_cache: fresh as unknown as Record<string, unknown>,
      google_reviews_fetched_at: new Date().toISOString(),
    })
    .eq('id', venueId);
  if (error) {
    console.error('[refreshVenueGoogleReviews]', error.message);
    return null;
  }
  return fresh;
}

export function parseGoogleReviewsCache(raw: unknown): GoogleReviewsCachePayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const reviews = Array.isArray(o.reviews) ? o.reviews : [];
  const out: GoogleReviewsCachePayload = {
    rating: typeof o.rating === 'number' ? o.rating : null,
    userRatingCount: typeof o.userRatingCount === 'number' ? o.userRatingCount : 0,
    reviews: [],
  };
  for (const r of reviews) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    out.reviews.push({
      author_name: typeof x.author_name === 'string' ? x.author_name : 'Reviewer',
      rating: typeof x.rating === 'number' ? x.rating : 5,
      text: typeof x.text === 'string' ? x.text : '',
      published_at: typeof x.published_at === 'string' ? x.published_at : null,
      profile_photo_url:
        typeof x.profile_photo_url === 'string' && x.profile_photo_url.startsWith('http')
          ? x.profile_photo_url
          : null,
    });
  }
  return out;
}

export { isValidGooglePlaceId, isGoogleReviewsCacheStale } from './google-place-reviews';
