-- Migration 119: Add start_ai_concierge to marketing_automation_steps step_type constraint
-- The booking system sequence editor adds this step type but it was never included
-- in the DB CHECK constraint, causing all step saves to fail silently.

ALTER TABLE public.marketing_automation_steps
  DROP CONSTRAINT IF EXISTS marketing_automation_steps_step_type_check;

ALTER TABLE public.marketing_automation_steps
  ADD CONSTRAINT marketing_automation_steps_step_type_check
  CHECK (step_type IN (
    'delay',
    'send_email',
    'send_sms',
    'add_tag',
    'remove_tag',
    'change_stage',
    'create_conversation',
    'notify_owner',
    'start_ai_concierge'
  ));
