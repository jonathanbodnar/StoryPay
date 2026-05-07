-- migration 115: add status column to conversation_threads
-- Allows the concierge team to mark bride reply threads as closed/open
-- from the support inbox Close button without deleting any data.

ALTER TABLE public.conversation_threads
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'closed'));

CREATE INDEX IF NOT EXISTS conversation_threads_status_idx
  ON public.conversation_threads (status);
