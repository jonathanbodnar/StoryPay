-- 123: venue email verification (gate LunarPay merchant creation)
--
-- Background
-- ----------
-- /api/auth/signup currently creates a fully-active venue AND auto-
-- provisions a LunarPay merchant under the submitted email/phone. An
-- attacker can therefore register `someone-elses@email.com` and a real
-- merchant identity ends up under the wrong person.
--
-- After this migration:
--   * Signup persists the venue with email_verified_at = NULL and
--     SKIPS the LunarPay merchant create.
--   * A verification email is sent. The recipient clicks it,
--     /api/auth/verify-email/<token> flips email_verified_at = now()
--     and ONLY THEN does the LunarPay merchant get provisioned.
--   * Sign-in still works for unverified accounts so the user can
--     browse the dashboard, pick a plan, etc.; payment-related actions
--     remain gated by lunarpay_merchant_id (still NULL until verified).
--
-- Existing rows are grandfathered as already verified — they were
-- created under the old flow and we don't want to lock anyone out.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS email_verified_at                     timestamptz,
  ADD COLUMN IF NOT EXISTS email_verification_token              text,
  ADD COLUMN IF NOT EXISTS email_verification_token_expires_at   timestamptz,
  ADD COLUMN IF NOT EXISTS email_verification_sent_at            timestamptz;

-- Treat all existing venues as already verified (they predate this flow).
UPDATE public.venues
   SET email_verified_at = COALESCE(email_verified_at, created_at, now())
 WHERE email_verified_at IS NULL;

CREATE INDEX IF NOT EXISTS venues_email_verification_token_idx
  ON public.venues (email_verification_token)
  WHERE email_verification_token IS NOT NULL;
