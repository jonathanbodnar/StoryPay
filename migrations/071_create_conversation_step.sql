-- Add 'create_conversation' workflow step type.
-- This step automatically opens (or finds) a conversation thread for the
-- enrolled lead and logs a timestamped system message so the Conversations
-- inbox records when the lead entered the workflow and what automated
-- messages were sent.

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
      'create_conversation'
    )
  );
