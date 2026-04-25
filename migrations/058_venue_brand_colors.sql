-- Brand color palette: per-venue saved swatches that show up inside every
-- color picker across the dashboard (email builder, branding, etc).
-- Stored as a JSONB array of lowercase #rrggbb strings.
BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS brand_colors jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.venues.brand_colors IS
  'JSONB array of saved brand colors as lowercase #rrggbb hex strings.';

COMMIT;
