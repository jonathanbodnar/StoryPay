-- Persist the recipient address on each outgoing conversation message so the
-- UI can show "Sent to: foo@bar.com" with confidence (instead of relying on
-- the current venue_customers.customer_email, which may have changed since the
-- message was sent or may be a sync placeholder).
--
-- For SMS, we store the E.164 phone number we delivered to. For email, we
-- store the email address. NULL for inbound messages.
--
-- Idempotent — safe to re-run.

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS email_to text;

COMMENT ON COLUMN public.conversation_messages.email_to IS
  'Actual recipient address (email for email channel, E.164 phone for SMS) used at send time. NULL for inbound messages.';

NOTIFY pgrst, 'reload schema';
