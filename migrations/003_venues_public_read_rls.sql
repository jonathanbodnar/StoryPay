-- Allow the public directory (storyvenue.com) to read published venues.
--
-- Context: the live project's `public.venues` table has RLS enabled but no
-- anon-readable policy, so the directory's anon-key queries return zero rows
-- and every /venue/[slug] page 404s. The dashboard is unaffected because it
-- uses the service role key (which bypasses RLS).
--
-- This migration is idempotent — safe to re-run.

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read published venues" ON public.venues;
CREATE POLICY "Public can read published venues" ON public.venues
  FOR SELECT
  TO anon, authenticated
  USING (is_published = true);

-- Owners can read their own venue even when unpublished (so they can preview
-- their draft listing from the dashboard session if we ever switch to anon-
-- signed reads — the StoryPay dashboard currently uses the service role key
-- and doesn't rely on this policy, but it's safe to have).
DROP POLICY IF EXISTS "Owners can read own venue" ON public.venues;
CREATE POLICY "Owners can read own venue" ON public.venues
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

-- Service role keys bypass RLS automatically, so the StoryPay dashboard's
-- PATCH / INSERT / DELETE paths keep working without additional policies.

-- Verification: this should return the Barn row once run.
SELECT id, name, slug, is_published
  FROM public.venues
 WHERE slug IN ('thebarnatnewlbany', 'the-barn-at-new-albany');
