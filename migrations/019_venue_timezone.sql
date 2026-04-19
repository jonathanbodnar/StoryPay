-- Venue-local IANA timezone for calendar, appointments, and display (e.g. America/New_York).
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/New_York';

COMMENT ON COLUMN public.venues.timezone IS 'IANA time zone name for scheduling and local-time display.';
