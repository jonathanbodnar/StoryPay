-- ============================================================================
-- 007_calendar_recurrence.sql
--
-- Adds recurring-event support to calendar_events.
--
-- We store the rule as a single jsonb column so we don't have to track
-- per-occurrence rows in Postgres — occurrences are materialized at read
-- time by the API. This keeps creation O(1) and edits cascade trivially
-- (edit the parent → all future occurrences update).
--
-- rule shape:
--   {
--     "freq":      "daily" | "weekly" | "monthly" | "yearly",
--     "interval":  1,           -- every N periods
--     "until":     "YYYY-MM-DD",-- optional stop date (inclusive)
--     "count":     10           -- optional stop after N occurrences
--   }
--
-- end_at on the base row already captures multi-day duration, so no schema
-- change is needed there.
--
-- Idempotent — safe to re-run.
-- ============================================================================

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS recurrence_rule jsonb;

-- Loose sanity check: rule must be a JSON object (or null). We deliberately
-- don't validate every field here — the API layer owns that — but we do
-- reject scalars/arrays which would crash expansion.
DO $$ BEGIN
  ALTER TABLE public.calendar_events
    ADD CONSTRAINT calendar_events_recurrence_rule_is_object
    CHECK (
      recurrence_rule IS NULL
      OR jsonb_typeof(recurrence_rule) = 'object'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Recurring events tend to be queried by start date anyway, so a partial
-- index on the subset that actually has a rule keeps the index tiny.
CREATE INDEX IF NOT EXISTS calendar_events_recurring_idx
  ON public.calendar_events (venue_id, start_at)
  WHERE recurrence_rule IS NOT NULL;

NOTIFY pgrst, 'reload schema';
