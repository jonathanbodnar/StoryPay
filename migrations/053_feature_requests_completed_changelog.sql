-- 053_feature_requests_completed_changelog.sql
-- Adds completed_at and changelog_id to feature_requests if they are missing.
-- The admin PATCH handler writes these when a feature request is approved and
-- a changelog entry is auto-generated.

ALTER TABLE public.feature_requests
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS changelog_id uuid
    REFERENCES public.changelog_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE INDEX IF NOT EXISTS feature_requests_changelog_id_idx
  ON public.feature_requests (changelog_id)
  WHERE changelog_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
