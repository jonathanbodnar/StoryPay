-- 276: The public (anon) key could read every column of published venues
-- straight from PostgREST — password_hash, login_token, GHL/Calendly/LunarPay
-- tokens and more — plus all of venue_pricing_guides and directory_plans.
-- Nothing reads these tables with the public keys (the app's browsers only use
-- Supabase for couple sign-in; the directory and guide pages are served by our
-- API with the service key), so they become deny-all like every other table.
-- Found by the Oct 3 database-access audit; tests/flows/locked-database.test.ts
-- keeps them closed.

DROP POLICY IF EXISTS "Public can read published venues" ON public.venues;
DROP POLICY IF EXISTS "Owners can read own venue" ON public.venues;

DROP POLICY IF EXISTS "Public read enabled guides" ON public.venue_pricing_guides;
DROP POLICY IF EXISTS "anon_select_venue_pricing_guides" ON public.venue_pricing_guides;
DROP POLICY IF EXISTS "Owners manage their guide" ON public.venue_pricing_guides;
ALTER TABLE public.venue_pricing_guides ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'venue_pricing_guides' AND policyname = 'deny_direct_access') THEN
    CREATE POLICY deny_direct_access ON public.venue_pricing_guides FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

DROP POLICY IF EXISTS "Public read directory_plans" ON public.directory_plans;
DROP POLICY IF EXISTS "anon_select_directory_plans" ON public.directory_plans;
ALTER TABLE public.directory_plans ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'directory_plans' AND policyname = 'deny_direct_access') THEN
    CREATE POLICY deny_direct_access ON public.directory_plans FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
