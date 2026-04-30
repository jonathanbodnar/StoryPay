-- Add 'notify_owner' workflow step type.
-- This step sends an email and/or SMS alert to the venue owner directly,
-- with full canonical merge-variable rendering on subject and body.

ALTER TABLE public.marketing_automation_steps
  DROP CONSTRAINT IF EXISTS marketing_automation_steps_type_chk;

ALTER TABLE public.marketing_automation_steps
  ADD CONSTRAINT marketing_automation_steps_type_chk CHECK (
    step_type IN (
      'delay',
      'send_email',
      'send_sms',
      'add_tag',
      'remove_tag',
      'change_stage',
      'create_conversation',
      'notify_owner'
    )
  );
