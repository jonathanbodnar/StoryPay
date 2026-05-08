-- Migration 119: Allow start_ai_concierge in marketing_automation_steps.step_type
--
-- The booking system sequence editor adds a 'start_ai_concierge' step but it
-- was never included in the DB CHECK constraint, causing every step save
-- containing the AI Concierge block to fail at the DB level.
--
-- Different historic migrations created the constraint under two different
-- names (marketing_automation_steps_step_type_check and ..._type_chk), so we
-- defensively drop both before re-adding the permissive version.

ALTER TABLE public.marketing_automation_steps
  DROP CONSTRAINT IF EXISTS marketing_automation_steps_step_type_check;

ALTER TABLE public.marketing_automation_steps
  DROP CONSTRAINT IF EXISTS marketing_automation_steps_type_chk;

ALTER TABLE public.marketing_automation_steps
  ADD CONSTRAINT marketing_automation_steps_type_chk
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
