-- Migration 281: a couple's reaction to a text shows in the thread (owner, Oct 7 2026).
--
-- When a bride "likes" a text, her phone sends the venue a reaction
-- ("Liked “See you Saturday at 2!”"). Until now it was dropped on its way in
-- (or, where the texting account pushes messages to us, stored as a reply).
-- The owner's rule: "if the bride likes something, we should show it, but it
-- should not stop any of the follow-ups."
--
-- So a reaction is stored as a row that is nobody's reply: sender_kind
-- 'system', sent_via 'reaction', with her name beside it. Everything that
-- looks for a reply looks for sender_kind 'contact', so nothing mistakes it
-- for one. Two things in the database need to know about it:
--
-- 1. sent_via may now say 'reaction'.
-- 2. The trigger that notes when a lead and a venue last wrote leaves a
--    reaction alone. It reads 'system' rows as the venue having written,
--    which a reaction is not; and it must never read as the bride having
--    written, which is what stops her follow-ups.
--
-- Additive and safe to run again. Until it is applied, the app's attempt to
-- store a reaction is refused by the old rule and nothing is stored: exactly
-- what happened before.

-- 1. A reaction is one of the ways a row can have come in.
ALTER TABLE public.conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_sent_via_check;
ALTER TABLE public.conversation_messages
  ADD CONSTRAINT conversation_messages_sent_via_check
  CHECK (sent_via IS NULL OR sent_via IN ('crm_user', 'crm_workflow', 'crm_api', 'reaction'));

COMMENT ON COLUMN public.conversation_messages.sent_via IS
  'Set on rows brought in from the venue''s texting account that StoryVenue did not send: crm_user (a person, from the CRM app), crm_workflow (a CRM automation), crm_api (another app through the CRM), reaction (the couple reacted to a text: shown in the thread, never counted as a reply).';

-- 2. The same function as the database has today (migration 106, with the
--    fixed search_path it was given since: replacing a function drops that
--    setting unless it is said again), with one rule added: a reaction moves
--    neither "last inbound" nor "last outbound".
CREATE OR REPLACE FUNCTION public.ai_concierge_touch_lead_message_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_venue_id UUID;
  v_email    TEXT;
BEGIN
  IF NEW.sent_via = 'reaction' THEN
    RETURN NEW;
  END IF;

  SELECT vc.venue_id, vc.customer_email
    INTO v_venue_id, v_email
    FROM public.conversation_threads ct
    JOIN public.venue_customers vc ON vc.id = ct.venue_customer_id
   WHERE ct.id = NEW.thread_id;

  IF v_venue_id IS NULL OR v_email IS NULL OR v_email = '' THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_kind = 'contact' THEN
    UPDATE public.leads
       SET last_inbound_at = NEW.created_at
     WHERE venue_id = v_venue_id
       AND lower(email) = lower(v_email);
  ELSIF NEW.sender_kind IN ('owner', 'team', 'system', 'ai', 'concierge') THEN
    UPDATE public.leads
       SET last_outbound_at = NEW.created_at
     WHERE venue_id = v_venue_id
       AND lower(email) = lower(v_email);
  END IF;

  RETURN NEW;
END;
$$;
