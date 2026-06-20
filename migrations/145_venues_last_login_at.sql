-- Migration 145 — add last_login_at to venues.
--
-- Stamps the UTC timestamp of the venue owner's most recent successful
-- password-based sign-in so the super-admin venue list can show "last seen"
-- alongside the account creation date.
--
-- Idempotent — safe to re-run.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS venues_last_login_at_idx
  ON public.venues (last_login_at DESC NULLS LAST);

-- Back-fill is not possible (sign-in history isn't stored), so existing rows
-- will show NULL ("Never") until the owner next logs in.

NOTIFY pgrst, 'reload schema';
