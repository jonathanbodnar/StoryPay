-- Shared venue media library: image assets stored in `venue-images` under
-- `{venue_id}/media/...`, tracked here for listing reuse, email, forms, etc.
-- Video uploads are rejected at the API layer (images only).

CREATE TABLE IF NOT EXISTS public.venue_media_assets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  storage_path  text        NOT NULL,
  public_url    text        NOT NULL,
  file_name     text        NOT NULL,
  content_type  text        NOT NULL,
  size_bytes    bigint      NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_media_assets_size_chk CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT venue_media_assets_path_uniq UNIQUE (venue_id, storage_path)
);

CREATE INDEX IF NOT EXISTS venue_media_assets_venue_created_idx
  ON public.venue_media_assets (venue_id, created_at DESC);

COMMENT ON TABLE public.venue_media_assets IS 'Venue-scoped image library metadata; files live in storage bucket venue-images.';

-- Access only via server (service role); API routes scope by venue_id cookie.
ALTER TABLE public.venue_media_assets DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_media_assets TO service_role;

NOTIFY pgrst, 'reload schema';
