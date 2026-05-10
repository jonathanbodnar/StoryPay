-- Add about_photos column to venue_pricing_guides for the 2×2 photo grid
-- that appears below the About the Venue text on the PDF about page.
ALTER TABLE public.venue_pricing_guides
  ADD COLUMN IF NOT EXISTS about_photos JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.venue_pricing_guides.about_photos IS
  'JSONB array of {url, caption} objects (max 4) used for the 2×2 photo grid on the PDF about page.';
