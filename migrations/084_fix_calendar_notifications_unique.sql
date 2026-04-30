-- ─────────────────────────────────────────────────────────────────────────────
-- 084 · Fix venue_calendar_notifications unique constraints for multi-calendar
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 076 defined UNIQUE (venue_id, notification_type, channel) with no
-- calendar_id included. This means any attempt to INSERT a per-calendar row
-- (calendar_id NOT NULL) would conflict with the venue-wide row, causing the
-- upsert fallback to corrupt venue-wide defaults.
--
-- Fix:
--   1. Orphaned-row cleanup — rows whose calendar_id no longer references a
--      real calendar get reset to NULL (venue-wide defaults).
--   2. Deduplicate any NULL rows that were duplicated by the bug.
--   3. Drop the old full unique constraint.
--   4. Add two partial unique indexes:
--        - venue-wide defaults   (calendar_id IS NULL)
--        - per-calendar overrides (calendar_id IS NOT NULL)

-- ── 1. Reset orphaned calendar_id references to NULL ─────────────────────────
UPDATE public.venue_calendar_notifications
SET calendar_id = NULL
WHERE calendar_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.venue_calendars
    WHERE public.venue_calendars.id = public.venue_calendar_notifications.calendar_id
  );

-- ── 2. Deduplicate NULL rows — keep the most recently updated per type+channel ─
DELETE FROM public.venue_calendar_notifications a
USING public.venue_calendar_notifications b
WHERE a.calendar_id IS NULL
  AND b.calendar_id IS NULL
  AND a.venue_id          = b.venue_id
  AND a.notification_type = b.notification_type
  AND a.channel           = b.channel
  AND a.updated_at        < b.updated_at;

-- ── 3. Drop the old full unique constraint ────────────────────────────────────
ALTER TABLE public.venue_calendar_notifications
  DROP CONSTRAINT IF EXISTS venue_calendar_notifications_venue_id_notification_type_channel_key;

-- ── 4a. Partial unique index — venue-wide defaults ────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS vcn_default_uidx
  ON public.venue_calendar_notifications (venue_id, notification_type, channel)
  WHERE calendar_id IS NULL;

-- ── 4b. Partial unique index — per-calendar overrides ─────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS vcn_per_calendar_uidx
  ON public.venue_calendar_notifications (venue_id, notification_type, channel, calendar_id)
  WHERE calendar_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
