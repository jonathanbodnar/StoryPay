-- Migration 268: close public access to the Wedding Planner tables.
--
-- Why: these five tables were created without row level security, and the
-- anon role still held Supabase's default table grants. The anon key ships in
-- the browser (couple sign-in), so anyone could read, change or TRUNCATE guest
-- lists, weddings, couple websites and guestbooks through the REST API.
--
-- The app never reads these tables from the browser: every couple and venue
-- route goes through the server with the service role, which bypasses RLS. So
-- enabling RLS with the same deny-all policy the other tables use changes
-- nothing for the app and shuts the public door.
--
-- Also: upsert_help_embedding_v2 is SECURITY DEFINER and anon could execute
-- it, letting anyone overwrite the help assistant's search index. Only the
-- server (service role) calls it.
--
-- Safety: additive and reversible (DISABLE ROW LEVEL SECURITY undoes it).
-- Idempotent.

ALTER TABLE public.couple_weddings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_guests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_tables           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_sites             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_guestbook_entries ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['couple_weddings','wedding_guests','wedding_tables','couple_sites','couple_guestbook_entries'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'deny_direct_access') THEN
      EXECUTE format('CREATE POLICY deny_direct_access ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.upsert_help_embedding_v2(text, vector, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_help_embedding_v2(text, vector, text, timestamp with time zone) TO service_role;
