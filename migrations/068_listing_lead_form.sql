-- 068_listing_lead_form.sql
-- Adds venue_matters column to leads (new listing form question).
-- Adds is_listing_form flag to marketing_forms so the venue-listing
-- lead gen form can be identified as a workflow trigger source.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS venue_matters text;

ALTER TABLE public.marketing_forms
  ADD COLUMN IF NOT EXISTS is_listing_form boolean NOT NULL DEFAULT false;

-- Ensure at most one listing form per venue
CREATE UNIQUE INDEX IF NOT EXISTS marketing_forms_venue_listing_uidx
  ON public.marketing_forms (venue_id)
  WHERE is_listing_form = true;

NOTIFY pgrst, 'reload schema';
