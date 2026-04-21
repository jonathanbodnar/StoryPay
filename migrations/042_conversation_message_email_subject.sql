-- Optional subject for outbound client emails (matches email composer UX).

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS email_subject text NULL;

COMMENT ON COLUMN public.conversation_messages.email_subject IS
  'For visibility=external, channel=email: subject line sent to the contact.';

NOTIFY pgrst, 'reload schema';
