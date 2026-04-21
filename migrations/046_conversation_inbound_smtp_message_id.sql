-- Dedupe inbound emails (e.g. Resend receiving) by RFC Message-ID or provider id.

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS smtp_message_id text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_smtp_message_id_key
  ON public.conversation_messages (smtp_message_id)
  WHERE smtp_message_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
