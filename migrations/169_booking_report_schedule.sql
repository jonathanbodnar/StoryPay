-- Booking system report scheduling: store recipient emails, on/off toggle,
-- and when the next auto-send should fire (NULL = never scheduled yet).
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS report_schedule_enabled   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS report_schedule_emails    TEXT[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS report_schedule_next_at   TIMESTAMPTZ          DEFAULT NULL;
