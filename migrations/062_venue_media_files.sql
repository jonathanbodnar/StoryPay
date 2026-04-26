-- Bump per-file size cap on the shared media library from 10 MB to 25 MB so it
-- matches the bucket config (`VENUE_FILE_MAX_BYTES` = 25 * 1024 * 1024) and the
-- new "files + images" upload UX. Also adds optional metadata columns the
-- overhauled library page uses for rename + future tagging.

ALTER TABLE public.venue_media_assets
  DROP CONSTRAINT IF EXISTS venue_media_assets_size_chk;

ALTER TABLE public.venue_media_assets
  ADD CONSTRAINT venue_media_assets_size_chk
  CHECK (size_bytes > 0 AND size_bytes <= 26214400);

-- Optional human-friendly display name. When NULL we fall back to file_name.
ALTER TABLE public.venue_media_assets
  ADD COLUMN IF NOT EXISTS display_name text;

-- Soft-delete column reserved for the future Trash workflow. Not consumed yet.
ALTER TABLE public.venue_media_assets
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS venue_media_assets_venue_active_idx
  ON public.venue_media_assets (venue_id, created_at DESC)
  WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
