-- ─────────────────────────────────────────────────────────────────────────────
-- 082 · Multi-calendar support
-- ─────────────────────────────────────────────────────────────────────────────
-- Allows venues to create multiple named calendars (e.g. "Tour Calendar",
-- "Phone Calls"). All calendars display on a single unified calendar view but
-- each can have its own independent notification templates.

-- ── 1. Named calendars ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_calendars (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  color       text        NOT NULL DEFAULT '#1b1b1b',
  description text,
  is_default  boolean     NOT NULL DEFAULT false,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Only one calendar can be the default per venue
CREATE UNIQUE INDEX IF NOT EXISTS venue_calendars_default_uidx
  ON public.venue_calendars (venue_id)
  WHERE is_default = true;

-- ── 2. Link calendar_events to a named calendar ──────────────────────────────
-- NULL = event pre-dates multi-calendar; uses venue-wide notification defaults.
ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS calendar_id uuid REFERENCES public.venue_calendars(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS calendar_events_calendar_id_idx
  ON public.calendar_events (calendar_id)
  WHERE calendar_id IS NOT NULL;

-- ── 3. Link notification templates to a specific calendar ────────────────────
-- NULL = venue-wide default (applies when the event's calendar has no own templates).
ALTER TABLE public.venue_calendar_notifications
  ADD COLUMN IF NOT EXISTS calendar_id uuid REFERENCES public.venue_calendars(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS venue_calendar_notifications_cal_idx
  ON public.venue_calendar_notifications (venue_id, calendar_id)
  WHERE calendar_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
