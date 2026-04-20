-- Google Maps Place ID + cached Places API (New) reviews for listing + directory.

BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS google_place_id text;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS google_reviews_cache jsonb;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS google_reviews_fetched_at timestamptz;

COMMENT ON COLUMN public.venues.google_place_id IS 'Google Maps Place ID (e.g. ChIJ...) for syncing public reviews via Places API (New).';
COMMENT ON COLUMN public.venues.google_reviews_cache IS 'Cached: { rating, userRatingCount, reviews: [...] } from Places API.';
COMMENT ON COLUMN public.venues.google_reviews_fetched_at IS 'When google_reviews_cache was last refreshed.';

COMMIT;
