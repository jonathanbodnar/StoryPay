-- 206: retire the email-verification requirement
--
-- Background
-- ----------
-- Migration 123 added a gate: signup left email_verified_at = NULL and
-- skipped LunarPay merchant provisioning until the owner clicked a
-- verification link, to stop someone from registering under a stranger's
-- email and getting a merchant identity provisioned under it.
--
-- In practice this never fully worked: the Settings onboarding flow
-- (/api/lunarpay/register) provisions a LunarPay merchant directly and never
-- checked email_verified_at, so owners could (and did — 6 confirmed in
-- production) get a merchant without ever verifying. Meanwhile 67% of
-- venues sat "unverified" indefinitely with a dashboard banner incorrectly
-- claiming they couldn't send proposals or take payments.
--
-- The application code no longer sends verification emails, shows the
-- banner, or reads this column for gating (see src/app/api/auth/signup,
-- src/components/DashboardShell.tsx, src/app/dashboard/layout.tsx). This
-- backfill just grandfathers every remaining unverified venue the same way
-- migration 123 originally grandfathered pre-existing rows.

UPDATE public.venues
   SET email_verified_at = COALESCE(email_verified_at, created_at, now())
 WHERE email_verified_at IS NULL;
