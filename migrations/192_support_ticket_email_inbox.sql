-- 192_support_ticket_email_inbox.sql — Unified support@storyvenue.com email inbox
-- ============================================================================
-- Adds inbound-email support for Venue Support tickets (support_threads).
--
-- Background: support@storyvenue.com is a Google Workspace Group that
-- forwards all mail to a fixed Resend-managed inbound address
-- (support@<CONVERSATIONS_INBOUND_DOMAIN>, e.g. support@inbound.storyvenue.com
-- — the same receiving domain already used for bride/venue-direct reply
-- routing). The inbound webhook resolves the sender's email against known
-- venues/team members and creates or appends to a support_threads ticket. If
-- the sender can't be matched to a known venue, we still create a ticket
-- (flagged is_unmatched) so nothing is silently dropped.
--
-- Sections:
--   1. support_threads — venue_id becomes nullable (unmatched/cold inquiry
--      tickets have no venue yet) + source/contact_* tracking columns.
--   2. support_thread_messages — contact_from_name/email + smtp_message_id
--      (dedupe, mirrors conversation_messages) + external_email_sent/send_error
--      (mirrors conversation_messages, records the new agent-reply outbound
--      email pipeline).
--
-- Idempotent: safe to re-run.

-- ============================================================================
-- 1. support_threads
-- ============================================================================

-- Unmatched/cold-inquiry tickets (sender email doesn't match any known venue
-- or venue team member) have no venue to attach to.
ALTER TABLE public.support_threads
  ALTER COLUMN venue_id DROP NOT NULL;

ALTER TABLE public.support_threads
  ADD COLUMN IF NOT EXISTS source          TEXT    NOT NULL DEFAULT 'dashboard',
  ADD COLUMN IF NOT EXISTS contact_email   TEXT,
  ADD COLUMN IF NOT EXISTS contact_name    TEXT,
  ADD COLUMN IF NOT EXISTS is_unmatched    BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_threads_source_check'
  ) THEN
    ALTER TABLE public.support_threads
      ADD CONSTRAINT support_threads_source_check
      CHECK (source IN ('dashboard', 'inbound_email'));
  END IF;
END $$;

-- Used to find the right open/pending ticket to append a follow-up email to
-- (per-venue for matched senders, per-contact-email for unmatched senders).
CREATE INDEX IF NOT EXISTS support_threads_contact_email_idx
  ON public.support_threads (lower(contact_email))
  WHERE contact_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS support_threads_source_idx
  ON public.support_threads (source);

-- ============================================================================
-- 2. support_thread_messages
-- ============================================================================
ALTER TABLE public.support_thread_messages
  ADD COLUMN IF NOT EXISTS contact_from_name    TEXT,
  ADD COLUMN IF NOT EXISTS contact_from_email   TEXT,
  ADD COLUMN IF NOT EXISTS smtp_message_id      TEXT,
  ADD COLUMN IF NOT EXISTS external_email_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS send_error           TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS support_thread_messages_smtp_message_id_key
  ON public.support_thread_messages (smtp_message_id)
  WHERE smtp_message_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
