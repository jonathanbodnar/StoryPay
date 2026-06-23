-- 148_venue_onboarding.sql
-- Adds onboarding-wizard state to venues so we can (a) decide whether to show
-- the post-registration "publish your guide" wizard and (b) power a resume
-- email ("you're 1 step from going live"). Additive + idempotent.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_last_step    SMALLINT DEFAULT 0;

-- Partial index: cheap lookups for "venues that started but never finished
-- onboarding" (the resume-email audience).
CREATE INDEX IF NOT EXISTS venues_onboarding_incomplete_idx
  ON public.venues (onboarding_last_step)
  WHERE onboarding_completed_at IS NULL;

NOTIFY pgrst, 'reload schema';
