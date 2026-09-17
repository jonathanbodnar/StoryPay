-- Migration 250: per-venue onboarding checklist for the admin Projects board.
--
-- Additive only: a single nullable JSONB column on venues storing the checklist
-- completion map ({ [item_key]: boolean }). Lives on the venue row so the same
-- state is available anywhere in the SaaS. Existing rows are unaffected
-- (project_checklist IS NULL → nothing checked). Read/written by the admin
-- Projects API via the service role only; not exposed to anon/authenticated.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS project_checklist jsonb;

NOTIFY pgrst, 'reload schema';
