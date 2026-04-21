-- Ensures star/pin columns exist on messages FIRST, then threads (044 backfill needs message cols).
-- Run in Supabase SQL editor if star/pin toggles error with "column ... does not exist".
-- Idempotent.

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS conversation_messages_thread_starred_idx
  ON public.conversation_messages (thread_id, is_starred)
  WHERE is_starred;

CREATE INDEX IF NOT EXISTS conversation_messages_thread_pinned_idx
  ON public.conversation_messages (thread_id, is_pinned)
  WHERE is_pinned;

ALTER TABLE public.conversation_threads
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

UPDATE public.conversation_threads t
SET is_starred = true
WHERE EXISTS (
  SELECT 1
  FROM public.conversation_messages m
  WHERE m.thread_id = t.id AND m.is_starred = true
);

UPDATE public.conversation_threads t
SET is_pinned = true
WHERE EXISTS (
  SELECT 1
  FROM public.conversation_messages m
  WHERE m.thread_id = t.id AND m.is_pinned = true
);

CREATE INDEX IF NOT EXISTS conversation_threads_venue_pinned_last_idx
  ON public.conversation_threads (venue_id, is_pinned DESC, last_message_at DESC);

NOTIFY pgrst, 'reload schema';
