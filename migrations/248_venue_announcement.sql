-- Venue-owned announcement bar for the public listing page.
--
-- Additive only (expand): a single nullable JSONB column. Existing rows are
-- unaffected (announcement IS NULL → no strip). The reader is tolerant and
-- defaults every field, so old/partial shapes never break rendering.
--
-- Shape: { enabled: boolean, message: text, expires_at: timestamptz|null }
-- Message-only by design (no outbound link/button) so the strip never competes
-- with the pricing-guide lead-capture opt-in on the landing page.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS announcement jsonb;

-- The public directory (storyvenue.com / weddingdirectory repo) reads venues
-- with the ANON key under COLUMN-LEVEL grants, selecting only an allow-list of
-- columns. A new column is NOT auto-granted, so anon must be granted SELECT on
-- it explicitly or the directory's column-list SELECT fails with "permission
-- denied for table venues" and every venue page 404s. Mirror the other public
-- columns by granting SELECT to anon + authenticated.
GRANT SELECT (announcement) ON public.venues TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
