-- Per-venue toggle for accepting ACH (eCheck / bank account) payments on the
-- LunarPay-hosted checkout used by proposals and invoices.
--
-- Default ON: every existing venue can accept ACH alongside credit card.
-- LunarPay's hosted page will only display the ACH tab if the venue's Fortis
-- account also has ACH enabled during onboarding, so flipping this on for
-- venues without ACH-Fortis is a safe no-op.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS accept_ach boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.venues.accept_ach IS
  'When true, ACH (bank account / eCheck) is offered alongside credit card on customer-facing checkout pages.';
