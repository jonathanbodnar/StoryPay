-- ─────────────────────────────────────────────────────────────────────────────
-- 081 · Two-way Google Calendar sync linkage on calendar_events
-- ─────────────────────────────────────────────────────────────────────────────
-- Tracks the Google Calendar event/calendar IDs created (or linked) for each
-- StoryVenue calendar_event. Populated when a venue creates an event in the
-- SaaS and we push it to Google; consumed by PATCH/DELETE handlers so updates
-- and deletions in the SaaS propagate back to Google.
--
-- Both columns are nullable: events created before this migration, or for
-- venues without Google connected, will have NULL and the push helpers will
-- gracefully no-op.

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS google_event_id text,
  ADD COLUMN IF NOT EXISTS google_calendar_id text,
  ADD COLUMN IF NOT EXISTS google_html_link text;

-- Lookup index for the rare reverse lookup (e.g. avoiding duplicate inserts
-- if a Google webhook ever arrives for an event we already created).
CREATE INDEX IF NOT EXISTS calendar_events_google_event_id_idx
  ON public.calendar_events (google_event_id)
  WHERE google_event_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
