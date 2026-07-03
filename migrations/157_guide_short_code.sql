-- Migration 157: guide_short_code on venues
-- Adds a short, URL-safe code per venue used for branded short guide links.
-- Format: first 8 lowercase hex chars of the venue UUID (no dashes).
-- Result: /g/fcdca338  instead of  /guide/fcdca338-dcd8-4e33-8122-7b60209ae6ff

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS guide_short_code text;

-- Populate existing venues deterministically from their UUIDs.
UPDATE public.venues
   SET guide_short_code = substring(replace(id::text, '-', ''), 1, 8)
 WHERE guide_short_code IS NULL;

-- Ensure uniqueness (8-hex collision probability is negligible for any
-- reasonable number of venues, but the constraint protects us).
ALTER TABLE public.venues
  ADD CONSTRAINT venues_guide_short_code_unique UNIQUE (guide_short_code);

-- Index for the redirect lookup (GET /g/[code]).
CREATE INDEX IF NOT EXISTS venues_guide_short_code_idx ON public.venues (guide_short_code);

NOTIFY pgrst, 'reload schema';
