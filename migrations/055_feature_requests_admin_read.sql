-- 055_feature_requests_admin_read.sql
-- Adds admin_read_at to feature_requests so the super admin can track which
-- venue-submitted requests they have reviewed.  NULL = unread (new).

ALTER TABLE public.feature_requests
  ADD COLUMN IF NOT EXISTS admin_read_at timestamptz DEFAULT NULL;

-- Index lets us cheaply count unread requests for the sidebar badge.
CREATE INDEX IF NOT EXISTS feature_requests_admin_read_at_idx
  ON public.feature_requests (admin_read_at)
  WHERE admin_read_at IS NULL;

NOTIFY pgrst, 'reload schema';
