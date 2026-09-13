-- ============================================================================
-- 242_wedding_planner_rename_contract.sql
--
-- CONTRACT half of the Wedding Hub -> Wedding Planner column rename (see 241).
-- Run ONLY after the code that reads/writes wedding_planner /
-- wedding_planner_visibility is fully deployed. Drops the now-unused old
-- columns.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.venues DROP COLUMN IF EXISTS wedding_hub;
ALTER TABLE public.venues DROP COLUMN IF EXISTS wedding_hub_visibility;

NOTIFY pgrst, 'reload schema';

COMMIT;
