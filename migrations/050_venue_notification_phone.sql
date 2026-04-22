-- 050: Add notification_phone column to venues (listing lead notifications)
--
-- SaaS is US-only, so the column stores E.164 strings with a +1 country code
-- (e.g. "+16145551234"). Sanitizer in src/lib/listing-sanitize.ts normalizes
-- anything the owner types into that shape before insert/update.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS notification_phone text;

COMMENT ON COLUMN public.venues.notification_phone IS
  'E.164 phone for directory lead notifications (USA-only, always +1XXXXXXXXXX).';

NOTIFY pgrst, 'reload schema';
