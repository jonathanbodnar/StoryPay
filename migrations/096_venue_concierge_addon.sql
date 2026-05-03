-- Migration 096: Venue Concierge add-on
-- Adds the concierge addon flag to venues.
-- Visibility per plan is controlled by feature_flags.addon_concierge_available
-- on the directory_plans row (set in the super admin panel).

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_addon_concierge BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.venues.directory_addon_concierge IS
  'Whether the venue has purchased the Venue Concierge add-on (personal + AI lead follow-up).';

NOTIFY pgrst, 'reload schema';
