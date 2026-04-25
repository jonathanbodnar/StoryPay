-- Adds a JSONB column on `venues` to hold the venue's social network links.
-- Marketing email "Social Links" blocks read directly from this list — there
-- is no per-block link list. Format: [{ "platform": "instagram", "url": "https://..." }, ...]
BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS brand_socials jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.venues.brand_socials IS
  'JSONB array of {platform, url} entries. Used by the marketing email Social Links block.';

COMMIT;
