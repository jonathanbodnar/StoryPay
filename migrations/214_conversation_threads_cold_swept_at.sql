-- 214: Cold-sweep watermark for dormant GHL SMS threads
--
-- Context: inbound SMS for GHL-connected venues is discovered by the poller in
-- src/lib/ghl-inbound-sync-cron.ts. The hot tier (SMS activity in the last
-- 60 min) and baseline sweep (last ~14 days) both key off recent activity, so a
-- thread that has been dormant for weeks stops being polled entirely — a bride's
-- reply on such a thread then only surfaces when someone next opens the thread,
-- which can be days later and, once imported with GHL's backdated dateAdded, no
-- longer fires a fresh "new reply" alert (see inbound-notification-gate.ts and
-- the White Pine Manor 2026-09 incident).
--
-- The new low-frequency "cold sweep" (runGhlColdThreadSync) polls threads whose
-- last activity is between MIN_DAYS and MAX_DAYS old, round-robin, spreading a
-- bounded per-run budget across runs so a large account can't blow GHL's rate
-- limits. cold_swept_at is the per-thread watermark: we always poll the
-- least-recently-swept cold threads first and stamp this after each poll, so no
-- thread is re-scanned until the rest of the cold set has had a turn.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.conversation_threads
  ADD COLUMN IF NOT EXISTS cold_swept_at timestamptz;

COMMENT ON COLUMN public.conversation_threads.cold_swept_at IS
  'Last time the low-frequency cold sweep (runGhlColdThreadSync) polled GHL for this dormant thread. NULL = never swept; ordered oldest-first for round-robin coverage. See src/lib/ghl-inbound-sync-cron.ts.';

-- Supports the cold-sweep selection: pick the least-recently-swept dormant
-- threads (cold_swept_at ASC NULLS FIRST) whose last activity falls in the cold
-- window (last_message_at). NULLS FIRST is the btree default for ASC, so
-- never-swept threads are naturally picked up first.
CREATE INDEX IF NOT EXISTS conversation_threads_cold_sweep_idx
  ON public.conversation_threads (cold_swept_at ASC, last_message_at ASC);
