-- ============================================================================
-- 229_couple_profile_gallery.sql
--
-- Additive-only enhancements for the couple Profile + Wedding Website:
--   * couple_profiles.partner_first_name / partner_last_name — the partner's
--     name lives on the profile (was previously only a single free-text field
--     on couple_sites.partner_name, which we keep as a tolerant fallback).
--   * couple_profiles.guest_count — the couple's own estimated headcount.
--   * couple_sites.gallery — JSONB array of image URLs for the Pinterest-style
--     mini gallery (capped in app code).
--
-- Every column is nullable or defaulted, so existing rows are untouched and no
-- reader/writer breaks. Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.couple_profiles
  ADD COLUMN IF NOT EXISTS partner_first_name TEXT,
  ADD COLUMN IF NOT EXISTS partner_last_name  TEXT,
  ADD COLUMN IF NOT EXISTS guest_count        INTEGER;

ALTER TABLE public.couple_sites
  ADD COLUMN IF NOT EXISTS gallery JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
