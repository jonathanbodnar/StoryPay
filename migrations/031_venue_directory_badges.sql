-- Directory "Verified" (blue badge) and "Sponsored" labels for published venues.
-- Workflow per flag: none → draft | pending → approved | rejected (admin); venue may request pending.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_verified_status text NOT NULL DEFAULT 'none';

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_sponsored_status text NOT NULL DEFAULT 'none';

COMMENT ON COLUMN public.venues.directory_verified_status IS 'none|draft|pending|approved|rejected — public shows verified badge only when approved';
COMMENT ON COLUMN public.venues.directory_sponsored_status IS 'none|draft|pending|approved|rejected — public shows Sponsored only when approved';

-- Enforce allowed values (idempotent: drop first if re-run)
ALTER TABLE public.venues DROP CONSTRAINT IF EXISTS venues_directory_verified_status_chk;
ALTER TABLE public.venues ADD CONSTRAINT venues_directory_verified_status_chk
  CHECK (directory_verified_status IN ('none', 'draft', 'pending', 'approved', 'rejected'));

ALTER TABLE public.venues DROP CONSTRAINT IF EXISTS venues_directory_sponsored_status_chk;
ALTER TABLE public.venues ADD CONSTRAINT venues_directory_sponsored_status_chk
  CHECK (directory_sponsored_status IN ('none', 'draft', 'pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS venues_directory_badges_published_idx
  ON public.venues (is_published)
  WHERE is_published = true;

NOTIFY pgrst, 'reload schema';
