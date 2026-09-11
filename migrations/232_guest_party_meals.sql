-- ============================================================================
-- 232_guest_party_meals.sql
--
-- Per-attendee meals + allergies for a guest party.
--
-- A `wedding_guests` row represents a party (with `party_size`). Until now the
-- whole party shared one `meal_choice` + `dietary_notes`. This adds an optional
-- per-person breakdown so, e.g., a party of 3 can pick 3 different meals and
-- each list their own allergies.
--
--   party_meals :: [{ "meal": string|null, "dietary": string|null }, ...]
--
-- Additive + tolerant: existing rows default to '[]' (no breakdown yet). The
-- legacy `meal_choice` / `dietary_notes` columns stay the source of truth for
-- old readers and are kept in sync on write (first chosen meal + combined
-- allergies), so every couple/venue view keeps working unchanged.
-- ============================================================================

BEGIN;

ALTER TABLE public.wedding_guests
  ADD COLUMN IF NOT EXISTS party_meals JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
