-- GA4 numeric Property ID (for Data API / in-dashboard reports). Separate from Measurement ID (G-...) used for gtag.

BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS ga4_property_id text;

COMMENT ON COLUMN public.venues.ga4_property_id IS 'GA4 property numeric ID (Admin → Property settings) for Data API reports in the dashboard. Optional.';

COMMIT;

NOTIFY pgrst, 'reload schema';
