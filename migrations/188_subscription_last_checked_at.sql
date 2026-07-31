-- Caches the timestamp of the last LunarPay subscription status check.
-- Used by checkAndSyncSubscriptionStatus() to avoid calling LP on every
-- dashboard page load — the check is skipped if performed within the last hour.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS subscription_last_checked_at timestamptz;
