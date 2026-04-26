-- Track which storage bucket each media asset lives in so the same library row
-- can represent files outside the default `venue-images` bucket (most notably
-- the brand logo, which lives in `venue-assets`). Existing rows default to
-- 'venue-images', matching the historical behaviour.

ALTER TABLE public.venue_media_assets
  ADD COLUMN IF NOT EXISTS source_bucket text NOT NULL DEFAULT 'venue-images';

NOTIFY pgrst, 'reload schema';
