-- Migration 190 — HOTFIX: restore public read access to directory_plans.
--
-- Migration 189 included directory_plans in its "no anon/authenticated
-- consumer found" batch and locked it to deny-all. That was wrong: the public
-- storyvenue.com directory site (weddingdirectory repo) reads this table
-- directly with the anon key on every venue landing page —
--
--   src/app/venue/[slug]/page.tsx:
--     supabase.from("directory_plans").select("nav_permissions, hide_header")
--
-- weddingdirectory's Supabase client (src/lib/supabase/server.ts) is
-- explicitly the public anon client ("public RLS policies apply" per its own
-- comment), and it resolves to this same backend project in production. Once
-- directory_plans was denied, `nav_permissions["nav_listing_pricing_guide"]`
-- could never be read, so pricingGuideEnabled defaulted to false for every
-- venue — this is why the "Download Pricing & Availability Guide" CTA
-- disappeared from every public listing that had it enabled.
--
-- directory_plans holds plan-tier feature flags (nav_permissions, hide_header)
-- — not tenant secrets or PII — so public SELECT is the correct, safe fix,
-- the same treatment venue_pricing_guides already has. Only SELECT is
-- restored; writes remain server-only (service_role bypasses RLS regardless).
--
-- Idempotent — safe to re-run.

DROP POLICY IF EXISTS "deny_direct_access" ON public.directory_plans;

DO $$
BEGIN
  IF to_regclass('public.directory_plans') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY "Public read directory_plans" ON public.directory_plans FOR SELECT TO anon, authenticated USING (true)';
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- RLS stays ENABLED (from migration 189) — this just adds back the one SELECT
-- policy the public site actually needs. INSERT/UPDATE/DELETE remain fully
-- denied to anon/authenticated (service_role still has unrestricted access).

NOTIFY pgrst, 'reload schema';
