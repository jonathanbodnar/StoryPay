-- 151_venue_onboarding_activated.sql
-- Stamp the true onboarding "activation moment": when the owner fires a test
-- inquiry through their own published Bride Booking System and watches a lead
-- land in their inbox. Distinct from onboarding_completed_at (publish) so we
-- can measure who actually saw the system work.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS onboarding_activated_at timestamptz;

NOTIFY pgrst, 'reload schema';
