-- Migration 258: LeadFinder™ crash recovery for arrivals left `pending`.
--
-- Why: an arrival row is written BEFORE it is processed, so nothing is lost —
-- but if the process dies part-way (a deploy restart, a timeout), the row stays
-- `pending` forever. The provider retries the webhook, the retry sees the row
-- and treats it as a duplicate, and the inquiry never becomes a lead or reaches
-- the venue's inbox.
--
-- These two columns let a retry take over an abandoned attempt safely:
--   processing_attempts   — how many times a retry has taken over. The takeover
--                           is an optimistic UPDATE ... WHERE processing_attempts
--                           = <value read>, so two concurrent retries can never
--                           both proceed, and it is capped in application code.
--   processing_started_at — when the current attempt began; an attempt older
--                           than a few minutes is considered abandoned. NULL means
--                           "the first attempt", which is timed from created_at.
--
-- Safety: purely additive, expand-only. The constant DEFAULT is instant on
-- Postgres 11+ (no table rewrite) and every existing row reads correctly
-- through it. The application tolerates these columns being absent (recovery
-- is simply disabled until this runs), so deploy order does not matter.
-- Idempotent: re-running is a no-op.

ALTER TABLE public.leadfinder_imports
  ADD COLUMN IF NOT EXISTS processing_attempts   integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

COMMENT ON COLUMN public.leadfinder_imports.processing_attempts IS
  'How many times a webhook retry has taken over this arrival after an earlier attempt was abandoned mid-processing. Capped in application code.';

COMMENT ON COLUMN public.leadfinder_imports.processing_started_at IS
  'When the current processing attempt began. NULL for the first attempt (timed from created_at). A pending row older than a few minutes is considered abandoned and may be taken over by a retry.';

-- Tell PostgREST to reload its schema cache.
NOTIFY pgrst, 'reload schema';
