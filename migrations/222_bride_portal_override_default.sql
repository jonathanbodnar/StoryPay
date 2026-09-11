-- ============================================================================
-- 222_bride_portal_override_default.sql
--
-- Re-scope venues.bride_portal from "included by default (TRUE)" to an explicit
-- OFF-PLAN OVERRIDE flag (default FALSE).
--
-- New gating (see src/lib/plan-features.ts):
--   * Legacy + All-Inclusive (private-client / paid) plans get the Bride Portal
--     automatically from their plan.
--   * $97 and Free plans do NOT get it unless an admin checks the Bride Portal
--     box — bride_portal = TRUE is the single source of truth that overrides
--     the gate and unlocks the feature off-plan.
--
-- Migration 221 shipped with DEFAULT TRUE, so every row is currently TRUE (which
-- would wrongly grant $97/Free venues). Reset all rows to FALSE; paid/legacy
-- venues keep access through the plan logic, so no access is lost.
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.venues
  ALTER COLUMN bride_portal SET DEFAULT FALSE;

UPDATE public.venues
  SET bride_portal = FALSE
  WHERE bride_portal IS DISTINCT FROM FALSE;

COMMENT ON COLUMN public.venues.bride_portal IS
  'Off-plan override for the Bride Portal. Legacy + All-Inclusive plans get the portal automatically; for $97/Free plans this flag (default FALSE) unlocks it. Single source of truth for granting off-plan.';

NOTIFY pgrst, 'reload schema';

COMMIT;
