-- Speed-to-Lead MVP: form-submission trigger + reply-halt for workflow enrollments.
--
-- 1. Extend the enrollment status check constraint with `halted_by_reply` so
--    we can semantically distinguish "the contact replied during the drip"
--    from a generic `cancelled` (which we still keep for manual stops). The
--    existing values stay legal; this is a pure superset.
--
-- No new tables: form-trigger config lives in the existing
-- `marketing_automations.trigger_config` JSONB column as `{ form_ids: [] }`.

ALTER TABLE public.marketing_automation_enrollments
  DROP CONSTRAINT IF EXISTS marketing_automation_enrollments_status_chk;

ALTER TABLE public.marketing_automation_enrollments
  ADD CONSTRAINT marketing_automation_enrollments_status_chk
    CHECK (status IN ('active', 'completed', 'cancelled', 'failed', 'halted_by_reply'));

NOTIFY pgrst, 'reload schema';
