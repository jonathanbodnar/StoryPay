-- Per-proposal toggle for accepting ACH payments.
-- Defaults to true so existing proposals allow ACH (matching prior behavior).
-- When false, only credit card is offered on the LP checkout page.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS accept_ach boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.proposals.accept_ach IS
  'When true, ACH (bank account) is offered alongside credit card on this proposal''s checkout page.';
