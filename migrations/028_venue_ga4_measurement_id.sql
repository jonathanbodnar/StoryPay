-- GA4 Measurement ID (G-XXXXXXXX) for listing traffic; optional, set from dashboard listing → Analytics.

BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS ga4_measurement_id text;

COMMENT ON COLUMN public.venues.ga4_measurement_id IS 'Google Analytics 4 measurement ID (format G-...). Injected on published public listing pages when set.';

COMMIT;
