-- 066_workflow_optional_trigger.sql
-- Allow workflows to exist with no trigger configured.
-- The trigger_type column was NOT NULL; drop that constraint so the canvas
-- can save a blank workflow without forcing a trigger selection.
--
-- The existing CHECK constraint (trigger_type IN (...)) is unaffected:
-- PostgreSQL evaluates NULL IN (...) as NULL (unknown), which a CHECK
-- constraint treats as passing — so NULL automatically becomes allowed
-- once the NOT NULL constraint is removed.

ALTER TABLE public.marketing_automations
  ALTER COLUMN trigger_type DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
