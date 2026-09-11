-- ============================================================================
-- 226_wedding_hub_rename_contract.sql
--
-- CONTRACT half of the Bride Portal -> Wedding Hub column rename (see 225).
-- Run ONLY after the code that reads/writes wedding_hub / wedding_hub_visibility
-- is fully deployed. Drops the now-unused old columns.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.venues DROP COLUMN IF EXISTS bride_portal;
ALTER TABLE public.venues DROP COLUMN IF EXISTS bride_portal_visibility;

NOTIFY pgrst, 'reload schema';

COMMIT;
