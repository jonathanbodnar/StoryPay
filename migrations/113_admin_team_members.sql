-- 113_admin_team_members.sql
-- ============================================================================
-- Extend support_team_members so it can also serve as the StoryVenue super-admin
-- team table:
--
--   first_name / last_name       — split out from the existing `name` column
--                                   (kept in sync; `name` remains as display)
--   avatar_url                    — profile picture URL (Supabase Storage)
--   admin_tabs_allowed            — jsonb map of admin tab key → boolean.
--                                   Empty/null = inherit role default. Used by
--                                   the admin layout to gate which sidebar tabs
--                                   are visible to non-super-admin staff.
--   is_super_admin                — true means full access to all admin tabs
--                                   AND the team management page itself.
--                                   The legacy ENV-based super admin always
--                                   has full access regardless of any DB row.
--
-- Idempotent. Safe to re-run.

ALTER TABLE public.support_team_members
  ADD COLUMN IF NOT EXISTS first_name         text,
  ADD COLUMN IF NOT EXISTS last_name          text,
  ADD COLUMN IF NOT EXISTS avatar_url         text,
  ADD COLUMN IF NOT EXISTS admin_tabs_allowed jsonb,
  ADD COLUMN IF NOT EXISTS is_super_admin     boolean NOT NULL DEFAULT false;

-- Backfill first_name / last_name from existing `name` column once
UPDATE public.support_team_members
SET first_name = COALESCE(NULLIF(split_part(name, ' ', 1), ''), name),
    last_name  = NULLIF(
      regexp_replace(name, '^\S+\s*', ''),
      ''
    )
WHERE first_name IS NULL;

NOTIFY pgrst, 'reload schema';
