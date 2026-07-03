-- Migration 159: Add service_role policies to tables with RLS enabled but no policies.
-- All 16 tables below are accessed exclusively server-side via supabaseAdmin (service_role key).
-- The service_role bypasses RLS entirely; these policies document the intent and
-- resolve the "rls_enabled_no_policy" advisory (16 tables flagged at INFO level).
-- No anon / authenticated direct-client access is granted (intentional).
--
-- Safe to re-run (CREATE POLICY IF NOT EXISTS not supported — uses DO blocks to guard).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='calendar_events' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.calendar_events
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='couple_profiles' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.couple_profiles
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='couple_saved_venues' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.couple_saved_venues
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_activity' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.customer_activity
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_files' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.customer_files
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_notes' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.customer_notes
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_tasks' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.customer_tasks
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='listing_reviews' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.listing_reviews
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='venue_availability' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.venue_availability
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='venue_calendar_notifications' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.venue_calendar_notifications
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='venue_calendar_settings' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.venue_calendar_settings
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='venue_conflict_calendars' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.venue_conflict_calendars
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='venue_customers' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.venue_customers
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='venue_date_overrides' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.venue_date_overrides
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='venue_media_assets' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.venue_media_assets
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='venue_spaces' AND policyname='service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON public.venue_spaces
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
