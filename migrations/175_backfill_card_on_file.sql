-- 175_backfill_card_on_file.sql
--
-- One-time backfill for directory_card_on_file (added in 174).
--
-- 174 defaults the column to FALSE and code sets it TRUE going forward when a
-- card is vaulted during onboarding. This backfill makes EXISTING venues that
-- already have a payment method vaulted consistent: any venue carrying a real
-- subscription on file (paid/trialing/past_due with an external subscription id)
-- must have had a card vaulted at LunarPay, so flip the flag TRUE.
--
-- Effect: these venues are correctly excluded from the onboarding card gate and
-- the dormant re-engagement drip / new-lead alerts (which only target venues
-- that completed setup but never added a card).
--
-- Idempotent: only touches rows currently FALSE/NULL. Safe to re-run.

UPDATE public.venues
SET directory_card_on_file = TRUE
WHERE COALESCE(directory_card_on_file, FALSE) = FALSE
  AND directory_subscription_external_id IS NOT NULL
  AND directory_subscription_status IN ('active', 'trialing', 'past_due');

-- Optional broader safety net (commented out by default): if any paid/trialing
-- venue predates external-id tracking but has a LunarPay customer record, it
-- also has a card vaulted. Uncomment if the query above leaves known-carded
-- venues untouched.
--
-- UPDATE public.venues
-- SET directory_card_on_file = TRUE
-- WHERE COALESCE(directory_card_on_file, FALSE) = FALSE
--   AND platform_lunarpay_customer_id IS NOT NULL
--   AND directory_subscription_status IN ('active', 'trialing', 'past_due');
