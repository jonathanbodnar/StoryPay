-- Admin OTP tokens for super admin two-factor login.
-- No user_id needed — there is only one super admin (env-based credentials).
CREATE TABLE IF NOT EXISTS admin_otp_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
