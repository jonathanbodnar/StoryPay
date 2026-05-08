-- 117_booking_system.sql
-- Adds venue-level config columns for the Booking System (Speed to Lead) page.
-- All columns default to NULL / false so existing venues see sensible defaults.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS booking_system_enabled       boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS booking_guide_email_enabled  boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS booking_guide_sms_enabled    boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS booking_guide_email_body     text,
  ADD COLUMN IF NOT EXISTS booking_guide_sms_body       text,
  ADD COLUMN IF NOT EXISTS booking_ai_max_days          integer     NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS booking_ai_min_gap_days      integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS booking_ai_max_gap_days      integer     NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS booking_ai_messages          text[];
