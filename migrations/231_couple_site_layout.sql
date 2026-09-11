-- ============================================================================
-- 231_couple_site_layout.sql
--
-- Wedding Website block ordering + rich story:
--   * couple_sites.section_order — ordered JSONB array of block keys
--     (e.g. ["countdown","story","gallery","links","embed"]) that drives the
--     public page order. App code tolerates missing/extra keys and defaults.
--   * couple_sites.story_html — sanitized rich HTML for the story block. The
--     legacy plain-text `story` column is kept in sync for previews/metadata,
--     so old rows keep rendering exactly as before (expand/contract-safe).
--
-- Additive only; existing rows are untouched. Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.couple_sites
  ADD COLUMN IF NOT EXISTS section_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS story_html    TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;
