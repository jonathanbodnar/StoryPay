-- ============================================================================
-- 025_listing_reviews_public_view.sql
-- Public read surface for listing reviews, consumed by storyvenue.com (the
-- public directory). The dashboard keeps full CRUD via service_role on the
-- base `public.listing_reviews` table (see 024_listing_reviews.sql); this
-- migration only adds a safe, read-only projection for the anon role.
--
-- Why a view (not an RLS policy on the base table):
--   - 024 explicitly DISABLEs RLS. Flipping it back on risks silently
--     breaking existing service_role-trusting code paths.
--   - A view lets us (a) filter to status = 'published' and (b) omit
--     columns we don't want exposed publicly (reviewer_email, status,
--     source) without touching the table's security model.
--
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE OR REPLACE VIEW public.listing_reviews_public
WITH (security_invoker = true) AS
SELECT
  id,
  venue_id,
  rating,
  title,
  body,
  reviewer_name,
  wedding_date,
  created_at
FROM public.listing_reviews
WHERE status = 'published';

COMMENT ON VIEW public.listing_reviews_public IS
  'Public read-only projection of listing_reviews. Only exposes status = ''published'' rows and hides reviewer_email/status/source. Consumed by storyvenue.com directory site (anon role).';

GRANT SELECT ON public.listing_reviews_public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
