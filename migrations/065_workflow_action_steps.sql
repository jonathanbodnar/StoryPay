-- 065_workflow_action_steps.sql
-- Extend marketing_automation_steps to support mid-workflow contact actions:
--   add_tag     — apply one or more tags to the enrolled contact
--   remove_tag  — remove one or more tags from the enrolled contact
--   change_stage — move the contact to a specific pipeline stage

ALTER TABLE public.marketing_automation_steps
  DROP CONSTRAINT IF EXISTS marketing_automation_steps_type_chk;

ALTER TABLE public.marketing_automation_steps
  ADD CONSTRAINT marketing_automation_steps_type_chk CHECK (
    step_type IN ('delay', 'send_email', 'send_sms', 'add_tag', 'remove_tag', 'change_stage')
  );
