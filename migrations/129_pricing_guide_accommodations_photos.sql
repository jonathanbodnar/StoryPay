-- Accommodations page redesign: replace single image with 4-photo 2×2 grid
-- (same pattern as about_photos added in migration 128)
ALTER TABLE public.venue_pricing_guides
  ADD COLUMN IF NOT EXISTS accommodations_photos JSONB NOT NULL DEFAULT '[]'::jsonb;
