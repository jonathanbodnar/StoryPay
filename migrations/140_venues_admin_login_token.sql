-- Migration 140: permanent admin login token for venues.
--
-- Separate from login_token (the user-facing single-use magic link). This
-- token never expires and is never rotated — it is only ever used by the
-- StoryVenue admin team via the "Copy login" button in the admin portal.
-- Regenerating it (e.g. for a compromised account) requires a manual DB
-- update or the admin-regen endpoint.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS admin_login_token UUID DEFAULT gen_random_uuid();

-- Backfill any existing rows that got a NULL (e.g. pre-default-value rows).
UPDATE public.venues
  SET admin_login_token = gen_random_uuid()
  WHERE admin_login_token IS NULL;

SELECT pg_notify('pgrst', 'reload schema');
