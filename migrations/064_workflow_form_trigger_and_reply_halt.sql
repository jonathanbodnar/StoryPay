-- Speed-to-Lead MVP: form-submission trigger + reply-halt for workflow enrollments.
--
-- 1. Extend the automation trigger_type check constraint with 'form_submitted'.
-- 2. Extend the enrollment status check constraint with 'halted_by_reply' so
--    we can semantically distinguish "the contact replied during the drip"
--    from a generic 'cancelled' (which we still keep for manual stops).
--
-- No new tables: form-trigger config lives in the existing
-- marketing_automations.trigger_config JSONB column as { form_ids: [] }.

-- Allow 'form_submitted' as a trigger type.
ALTER TABLE public.marketing_automations
  DROP CONSTRAINT IF EXISTS marketing_automations_trigger_chk;

ALTER TABLE public.marketing_automations
  ADD CONSTRAINT marketing_automations_trigger_chk CHECK (
    trigger_type IN (
      'tag_added',
      'stage_changed',
      'trigger_link_click',
      'wedding_date_followup',
      'proposal_paid',
      'form_submitted'
    )
  );

-- Allow 'halted_by_reply' as an enrollment status.
ALTER TABLE public.marketing_automation_enrollments
  DROP CONSTRAINT IF EXISTS marketing_automation_enrollments_status_chk;

ALTER TABLE public.marketing_automation_enrollments
  ADD CONSTRAINT marketing_automation_enrollments_status_chk
    CHECK (status IN ('active', 'completed', 'cancelled', 'failed', 'halted_by_reply'));

NOTIFY pgrst, 'reload schema';
