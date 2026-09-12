-- ============================================================================
-- 236_wedding_timeline.sql
--
-- Wedding "Day-of timeline" — a simple, shared schedule of the wedding day that
-- BOTH the couple and the venue can edit (rehearsal-to-send-off list of
-- time + event rows). Like the room layout, it is stored as one JSONB document
-- on couple_weddings so both sides (who already read/write that row) share it.
--
-- Purely additive — existing data is untouched, old rows default to '{}' and are
-- read tolerantly by sanitizeTimeline(), so nothing is lost and no couple/venue
-- is disrupted.
--
-- Shape: { "rev": <int>, "events": [ { id, time, title, note? } ] }
--   time = "HH:MM" 24h (or "" when unset)
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.couple_weddings
  ADD COLUMN IF NOT EXISTS timeline JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
