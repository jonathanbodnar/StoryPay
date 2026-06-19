-- Migration 144 — harden RLS on server-only tables.
--
-- These tables hold sensitive tenant data (integration/OAuth tokens, team-member
-- invite tokens that double as login credentials, integrations, notifications,
-- email templates) but had `ALL ... USING (true)` policies granted to the
-- anon/public role. With the publishable/anon key (which ships to the browser on
-- the homepage + couple portal), anyone could read/edit/delete these rows.
--
-- The entire backend reaches these tables through the service-role key, which
-- BYPASSES row-level security, so removing the permissive policies leaves RLS
-- enabled with no policy => anon/authenticated are fully denied while all
-- server-side functionality keeps working unchanged.
--
-- Verified: no browser/anon-key code references these tables.
-- Idempotent — safe to re-run (DROP POLICY IF EXISTS).

DROP POLICY IF EXISTS "service role full access"     ON public.venue_tokens;

DROP POLICY IF EXISTS "Allow all"                    ON public.venue_team_members;
DROP POLICY IF EXISTS "venue_team_members_all"       ON public.venue_team_members;

DROP POLICY IF EXISTS "venue_integrations_all"       ON public.venue_integrations;

DROP POLICY IF EXISTS "Allow all"                    ON public.venue_notifications;

DROP POLICY IF EXISTS "Allow all"                    ON public.venue_email_templates;
DROP POLICY IF EXISTS "venue_email_templates_all"    ON public.venue_email_templates;

-- Make sure RLS stays on (it already is) so the now-policyless tables deny anon.
ALTER TABLE public.venue_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_team_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_integrations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_notifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_email_templates ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
