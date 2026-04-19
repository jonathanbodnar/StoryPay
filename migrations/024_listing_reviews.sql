-- ============================================================================
-- 024_listing_reviews.sql — Internal listing reviews (StoryVenue-owned; future bride portal)
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.listing_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id           uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  rating             smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title              text,
  body               text NOT NULL,
  reviewer_name      text NOT NULL,
  reviewer_email     text,
  wedding_date       date,
  status             text NOT NULL DEFAULT 'published'
    CHECK (status IN ('pending', 'published', 'hidden')),
  source             text NOT NULL DEFAULT 'venue_dashboard'
    CHECK (source IN ('venue_dashboard', 'bride_portal', 'import')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_reviews_venue_created_idx
  ON public.listing_reviews (venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS listing_reviews_venue_status_idx
  ON public.listing_reviews (venue_id, status);

DROP TRIGGER IF EXISTS trg_listing_reviews_updated_at ON public.listing_reviews;
CREATE TRIGGER trg_listing_reviews_updated_at
  BEFORE UPDATE ON public.listing_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.listing_reviews DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_reviews TO service_role;

NOTIFY pgrst, 'reload schema';
