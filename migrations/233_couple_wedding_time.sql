-- ============================================================================
-- 233_couple_wedding_time.sql
--
-- Optional wedding start time on the couple profile, so the public minisite can
-- offer guests an "Add to calendar" event with a real start time (not just a
-- date). Stored as free-form text 'HH:MM' (24h); NULL = no time set yet.
--
-- Additive + nullable: existing profiles are untouched and simply have no time.
-- ============================================================================

BEGIN;

ALTER TABLE public.couple_profiles
  ADD COLUMN IF NOT EXISTS wedding_time TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;
