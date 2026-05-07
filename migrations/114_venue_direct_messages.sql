-- 114_venue_direct_messages.sql
-- ============================================================================
-- Adds a "Venue Direct" audience to conversation_messages so the StoryVenue
-- concierge team can chat with venue staff (about a specific bride contact)
-- without ever logging into the venue's subaccount.
--
-- Three audiences now coexist on conversation_messages:
--   external     — bride-visible (default; existing behaviour)
--   support_only — concierge-only internal note (existed as boolean column,
--                  kept in sync via a generated column for backwards compat)
--   venue_direct — visible to concierge team + venue staff, hidden from bride.
--                  Used for the new "Venue Direct" thread.
--
-- Idempotent. Safe to re-run.

-- 1. Add audience column with a check constraint.
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'external';

ALTER TABLE public.conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_audience_check;

ALTER TABLE public.conversation_messages
  ADD CONSTRAINT conversation_messages_audience_check
  CHECK (audience IN ('external', 'support_only', 'venue_direct'));

-- 2. Backfill existing rows. The legacy `support_only` boolean column maps
--    1:1 to audience='support_only'. Everything else stays 'external'.
UPDATE public.conversation_messages
SET    audience = 'support_only'
WHERE  support_only = TRUE
   AND audience    = 'external';

-- 3. Helpful indexes for the two main read paths.

-- (a) Concierge support inbox: list every audience for a thread.
--     Already indexed on (thread_id, created_at) by an earlier migration.

-- (b) Venue dashboard for a bride contact: list external + venue_direct,
--     ordered chronologically. Partial index keeps it tight.
CREATE INDEX IF NOT EXISTS idx_conversation_messages_audience_thread
  ON public.conversation_messages (thread_id, created_at)
  WHERE audience IN ('external', 'venue_direct');

-- (c) Per-thread unread venue_direct count for the bell badge on the venue side.
CREATE INDEX IF NOT EXISTS idx_conversation_messages_venue_direct_thread
  ON public.conversation_messages (thread_id, created_at)
  WHERE audience = 'venue_direct';

-- 4. Read state.
--    We deliberately re-use the existing `conversation_thread_reads` table to
--    track who has seen venue_direct messages — no new table needed. To keep
--    venue_direct read-state separate from the main bride conversation
--    read-state on the same thread, we prefix `reader_ref` with `vd:`:
--        "vd:owner"      → the venue's account holder
--        "vd:m:<uuid>"   → a venue_team_members.id
--    A thread is "unread venue_direct" for a reader when the reader has at
--    least one venue_direct message with created_at > last_read_at (or no row
--    in conversation_thread_reads for that reader_ref at all).

NOTIFY pgrst, 'reload schema';
