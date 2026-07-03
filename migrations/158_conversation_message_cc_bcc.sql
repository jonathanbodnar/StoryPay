-- Add email_cc / email_bcc to conversation_messages if they were not applied by migration 043.
-- Idempotent — safe to re-run.

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS email_cc  text,
  ADD COLUMN IF NOT EXISTS email_bcc text;

NOTIFY pgrst, 'reload schema';
