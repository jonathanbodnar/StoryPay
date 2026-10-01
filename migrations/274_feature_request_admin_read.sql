-- Migration 274: feature_requests.admin_read_at.
--
-- Why: Admin → Feature requests marks a request read and counts unread ones
-- for the sidebar badge through this column, but it was never created, so the
-- badge always showed 0 and reading a request saved nothing (the routes fall
-- back silently). Adding it makes both work with no code change.
--
-- Existing requests count as read (the owner has seen the list), so the badge
-- starts at 0 and only new requests light it up.
--
-- Safety: additive. Idempotent.

ALTER TABLE public.feature_requests ADD COLUMN IF NOT EXISTS admin_read_at timestamptz;
UPDATE public.feature_requests SET admin_read_at = now() WHERE admin_read_at IS NULL;

NOTIFY pgrst, 'reload schema';
