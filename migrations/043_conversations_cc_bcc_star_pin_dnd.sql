-- CC/BCC + trigger link ref + star/pin on messages; conversation DND prefs on contacts.
-- Idempotent — safe to re-run.

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS email_cc text,
  ADD COLUMN IF NOT EXISTS email_bcc text,
  ADD COLUMN IF NOT EXISTS trigger_link_id uuid REFERENCES public.trigger_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS conversation_messages_thread_starred_idx
  ON public.conversation_messages (thread_id, is_starred)
  WHERE is_starred;

CREATE INDEX IF NOT EXISTS conversation_messages_thread_pinned_idx
  ON public.conversation_messages (thread_id, is_pinned)
  WHERE is_pinned;

ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS conversation_dnd_all boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conversation_dnd_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conversation_dnd_calls boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conversation_dnd_inbound_sms boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.venue_customers.conversation_dnd_all IS
  'When true, block all outbound conversation email/SMS from StoryPay for this contact.';
COMMENT ON COLUMN public.venue_customers.conversation_dnd_email IS
  'When true, block outbound conversation emails.';
COMMENT ON COLUMN public.venue_customers.conversation_dnd_calls IS
  'Preference: do not call (UI + future integrations).';
COMMENT ON COLUMN public.venue_customers.conversation_dnd_inbound_sms IS
  'Preference: inbound SMS/calls handling (UI; SMS compliance still uses sms_dnd).';

NOTIFY pgrst, 'reload schema';
