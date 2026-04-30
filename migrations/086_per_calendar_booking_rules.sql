-- ─────────────────────────────────────────────────────────────────────────────
-- 086 · Per-calendar booking rules
--
-- Adds nullable booking-rule columns to venue_calendars so each calendar can
-- override the venue-wide defaults stored in venue_calendar_settings.
-- NULL on any column means "fall back to the venue-wide value".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.venue_calendars
  ADD COLUMN IF NOT EXISTS meeting_duration_min      int,
  ADD COLUMN IF NOT EXISTS meeting_interval_min      int,
  ADD COLUMN IF NOT EXISTS min_scheduling_notice_hrs int,
  ADD COLUMN IF NOT EXISTS date_range_days           int,
  ADD COLUMN IF NOT EXISTS pre_buffer_min            int,
  ADD COLUMN IF NOT EXISTS post_buffer_min           int,
  ADD COLUMN IF NOT EXISTS max_bookings_per_day      int,
  ADD COLUMN IF NOT EXISTS max_bookings_per_slot     int;

NOTIFY pgrst, 'reload schema';
