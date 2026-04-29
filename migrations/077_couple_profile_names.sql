-- 077_couple_profile_names.sql
-- Adds first_name and last_name to couple_profiles. Display name is kept
-- for backwards compatibility but is now derived from first/last in the UI.

ALTER TABLE public.couple_profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text;

NOTIFY pgrst, 'reload schema';
