-- 122: expire and rotate venue login_token (magic link)
--
-- Background
-- ----------
-- venues.login_token is the random string used in /login/<token> magic
-- links emailed to venue owners. Until now it was effectively a permanent
-- password — never expired, never rotated, valid forever from any
-- forwarded email. A leaked welcome/login email = forever access.
--
-- After this migration:
--  * Each /api/auth/request-login call rotates login_token and stamps
--    login_token_expires_at = now() + 24h.
--  * Each successful /api/auth/venue/<token> redemption rotates the
--    token to a fresh value and stamps login_token_last_used_at, so the
--    URL becomes single-use.
--  * Any token whose login_token_expires_at is in the past is rejected.
--  * Existing rows get a 7-day grace window so anyone with a recent
--    login email keeps working until they re-request.
--  * A NULL expires_at after this migration means "never issued / not
--    valid" — only legacy rows with grace-period set during migration
--    are accepted without an explicit re-issue.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS login_token_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS login_token_last_used_at timestamptz;

-- 7-day grace period for any existing venue with a login_token.
UPDATE public.venues
   SET login_token_expires_at = now() + interval '7 days'
 WHERE login_token IS NOT NULL
   AND login_token_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS venues_login_token_expires_at_idx
  ON public.venues (login_token_expires_at)
  WHERE login_token IS NOT NULL;
