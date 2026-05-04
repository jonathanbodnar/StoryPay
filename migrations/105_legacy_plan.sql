-- Migration 105: Legacy plan flag
-- ============================================================================
-- Marks a plan as "legacy" so venues on it:
--   • automatically receive all add-ons (verified, sponsored, concierge)
--     at no extra charge — no subscription required
--   • see a locked billing page that says billing is managed directly
--
-- Default FALSE so existing plans are unaffected.
-- ============================================================================

ALTER TABLE public.directory_plans
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
