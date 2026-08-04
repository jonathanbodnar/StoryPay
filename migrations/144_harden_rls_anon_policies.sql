-- Migration 144 — harden RLS on anon-exposed / server-only tables.
--
-- Reconciled 2026-08-04 against production (brxnhsaakmhgwcthcapd). Enumerating
-- pg_policies for permissive `USING (true)` policies showed the real anon
-- exposure was a different (and larger) set than this file originally targeted,
-- and that several prod policy names differ from the ones that were hard-coded
-- here (e.g. venue_tokens' policy is "Public read venue tokens by token", not
-- "service role full access"). A hard-coded DROP by name would therefore have
-- silently left the exposure in place. This version is NAME-AGNOSTIC: it drops
-- EVERY policy on each listed table, so it works regardless of the exact policy
-- names in any environment.
--
-- The entire backend reaches these tables through the service-role key, which
-- BYPASSES row-level security, so removing the permissive policies leaves RLS
-- enabled with no policy => anon/authenticated/public are fully denied while all
-- server-side functionality keeps working unchanged.
--
-- IMPORTANT — venue_pricing_guides is intentionally EXCLUDED: the public
-- marketing site (storyvenue.com) reads it via the anon key on venue landing
-- pages (the Meta-ad destinations). Do NOT lock it down here.
--
-- Verified: no browser/anon-key code references the locked tables. Idempotent —
-- safe to re-run (DROP POLICY IF EXISTS + guarded ENABLE RLS).

-- Audited tables with permissive anon policies in production (Query A). Includes
-- the two critical secret-token tables and the anon-writable PII/content tables.
-- The three pricing-guide/proposal children were confirmed to have no anon-key
-- consumer in either repo (least-privilege drop).
DO $$
DECLARE
  p   record;
  tbl text;
  targets text[] := ARRAY[
    -- CRITICAL: secret tokens readable by any anon-key holder under USING(true).
    'venue_tokens','card_update_tokens',
    -- HIGH: anon read/insert/update/delete of PII + platform content.
    'waitlist','announcements','changelog_entries',
    'feature_requests','feature_request_votes',
    -- Least-privilege (no anon consumer found in either repo).
    'venue_pricing_guide_packages','venue_pricing_guide_spaces','proposal_template_fields'
  ];
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY(targets)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;

  FOREACH tbl IN ARRAY targets LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END $$;

-- Legacy surgical drops from the original audit intent. These tables did not
-- carry permissive anon policies in production, so these are no-ops there, but
-- they keep the file defensive across other environments. Kept by name to avoid
-- dropping any legitimate restrictive policies elsewhere.
DROP POLICY IF EXISTS "service role full access"  ON public.venue_tokens;
DROP POLICY IF EXISTS "Allow all"                 ON public.venue_team_members;
DROP POLICY IF EXISTS "venue_team_members_all"    ON public.venue_team_members;
DROP POLICY IF EXISTS "venue_integrations_all"    ON public.venue_integrations;
DROP POLICY IF EXISTS "Allow all"                 ON public.venue_notifications;
DROP POLICY IF EXISTS "Allow all"                 ON public.venue_email_templates;
DROP POLICY IF EXISTS "venue_email_templates_all" ON public.venue_email_templates;

NOTIFY pgrst, 'reload schema';
