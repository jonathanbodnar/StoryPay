-- 193_support_inbox_ux_overhaul.sql
--
-- Support Inbox UX overhaul: attachments end-to-end + outbound delivery/read
-- status (Resend email + GHL/Twilio SMS) for conversation_messages (bride
-- replies / venue direct) and support_thread_messages (venue support tickets).
--
-- Idempotent — safe to re-run.

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_status  text,
  ADD COLUMN IF NOT EXISTS delivered_at     timestamptz,
  ADD COLUMN IF NOT EXISTS opened_at        timestamptz,
  ADD COLUMN IF NOT EXISTS bounced_at       timestamptz,
  ADD COLUMN IF NOT EXISTS resend_email_id  text,
  ADD COLUMN IF NOT EXISTS sms_status       text;

ALTER TABLE support_thread_messages
  ADD COLUMN IF NOT EXISTS delivery_status  text,
  ADD COLUMN IF NOT EXISTS delivered_at     timestamptz,
  ADD COLUMN IF NOT EXISTS opened_at        timestamptz,
  ADD COLUMN IF NOT EXISTS bounced_at       timestamptz,
  ADD COLUMN IF NOT EXISTS resend_email_id  text;

-- support_thread_messages.attachments already existed as jsonb (nullable) —
-- normalize existing NULLs and default new rows to '[]' for consistency with
-- conversation_messages.
ALTER TABLE support_thread_messages
  ALTER COLUMN attachments SET DEFAULT '[]'::jsonb;
UPDATE support_thread_messages SET attachments = '[]'::jsonb WHERE attachments IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_resend_email_id
  ON conversation_messages(resend_email_id) WHERE resend_email_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_thread_messages_resend_email_id
  ON support_thread_messages(resend_email_id) WHERE resend_email_id IS NOT NULL;
