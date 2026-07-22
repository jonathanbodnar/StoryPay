-- 174_venue_card_on_file.sql
--
-- Tracks whether a venue has a payment method vaulted at LunarPay, independent
-- of whether they carry an active paid subscription. Set true the moment a card
-- is successfully vaulted during onboarding (both the paid trial path and the
-- new $0 Free path). Used to:
--   • short-circuit the onboarding card gate (never re-prompt a carded venue),
--   • exclude Free-plan onboarders (carded, $0) from the dormant-venue
--     re-engagement drip + new-lead alert emails, which target venues that
--     completed setup but never added a card.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_card_on_file BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.venues.directory_card_on_file IS
  'True once a card is vaulted at LunarPay during onboarding (paid trial or Free plan). Excludes venue from dormant re-engagement emails and the onboarding card gate.';
