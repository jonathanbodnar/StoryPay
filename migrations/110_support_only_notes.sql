-- 110_support_only_notes.sql
-- ============================================================================
-- Internal support team notes — separate from the existing per-message
-- `support_internal_note` field. These are *standalone* messages that:
--
--   - Live in conversation_messages (so they share thread chronology)
--   - Are visible only to super admin / support agents
--   - Can @-mention support_team_members and trigger an email notification
--
-- Schema additions (idempotent):
--   conversation_messages.support_only                 - hide from venue inbox
--   conversation_messages.mentioned_support_user_ids   - notification fan-out
--
-- The venue dashboard messages endpoint MUST filter `WHERE NOT support_only`.
-- The admin support endpoints don't filter — they see everything.

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS support_only BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS mentioned_support_user_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- Partial index — most rows are not support_only, so only index the rare ones
CREATE INDEX IF NOT EXISTS idx_conversation_messages_support_only_thread
  ON public.conversation_messages (thread_id, created_at)
  WHERE support_only;

-- GIN index for mention lookups (used by the support-mentioned-me view if added later)
CREATE INDEX IF NOT EXISTS idx_conversation_messages_mentioned_support
  ON public.conversation_messages USING GIN (mentioned_support_user_ids)
  WHERE array_length(mentioned_support_user_ids, 1) > 0;

-- ─── Patch the touch-thread trigger ─────────────────────────────────────────
-- The original trigger updated `last_message_preview` for EVERY insert. That
-- would leak support-only note text into the venue's conversation list (the
-- venue's threads endpoint reads `conversation_threads.last_message_preview`
-- directly). Skip support_only inserts entirely so the venue still sees the
-- last venue/bride message in their inbox preview.

CREATE OR REPLACE FUNCTION public.conversation_touch_thread_on_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.support_only IS TRUE THEN
    RETURN NEW;  -- internal-to-support note; don't update thread summary
  END IF;
  UPDATE public.conversation_threads
  SET
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(NEW.body, 240),
    last_message_visibility = NEW.visibility,
    updated_at = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
