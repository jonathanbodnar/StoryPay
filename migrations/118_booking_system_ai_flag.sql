-- 118_booking_system_ai_flag.sql
-- Adds a flag to leads so the activation cron can distinguish between
-- leads activated by the Booking System workflow (start_ai_concierge step)
-- vs leads auto-activated by the 14-day timer.
--
-- When ai_booking_system_activated = true the activation cron skips the
-- lead entirely — it was already activated by the marketing worker.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS ai_booking_system_activated boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS leads_ai_booking_system_activated_idx
  ON public.leads (ai_booking_system_activated)
  WHERE ai_booking_system_activated = false;
