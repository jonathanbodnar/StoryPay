-- 125: TOTP-based 2FA for venue accounts
--
-- totp_secret           encrypted base32 secret used by authenticator apps
-- totp_enabled_at       timestamp set once the user successfully verified the
--                       first code; null means "setup started but not finished"
-- totp_backup_codes     array of bcrypt-hashed single-use recovery codes
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS totp_secret       text,
  ADD COLUMN IF NOT EXISTS totp_enabled_at   timestamptz,
  ADD COLUMN IF NOT EXISTS totp_backup_codes text[];

-- Index supports the "is 2FA enabled?" lookup on every sign-in
CREATE INDEX IF NOT EXISTS venues_totp_enabled_at_idx
  ON public.venues (totp_enabled_at)
  WHERE totp_enabled_at IS NOT NULL;
