-- Migration 155: numbered payment ledger for every payment (manual + online).
--
-- Builds on 154. Idempotent and self-contained: safe to run whether or not 154
-- was already applied. Adds a human-friendly sequential payment_number to every
-- payment, records the payment source (manual cash/check vs online cc/ach), and
-- a reference (LunarPay transaction/charge id) so cards & bank payments carry a
-- number too.

-- Base table (in case 154 wasn't applied).
CREATE TABLE IF NOT EXISTS public.proposal_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  venue_id     uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  method       text NOT NULL DEFAULT 'cash',
  check_number text,
  note         text,
  recorded_by  text,
  paid_at      timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proposal_payments_proposal ON public.proposal_payments(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_payments_venue ON public.proposal_payments(venue_id);

-- Sequential, human-friendly payment number (shared across all venues).
CREATE SEQUENCE IF NOT EXISTS public.proposal_payment_number_seq START 1001;

ALTER TABLE public.proposal_payments
  ADD COLUMN IF NOT EXISTS payment_number bigint;
ALTER TABLE public.proposal_payments
  ALTER COLUMN payment_number SET DEFAULT nextval('public.proposal_payment_number_seq');

-- Backfill any pre-existing rows that don't have a number yet.
UPDATE public.proposal_payments
  SET payment_number = nextval('public.proposal_payment_number_seq')
  WHERE payment_number IS NULL;

-- Source of the payment + external reference (for online charges).
ALTER TABLE public.proposal_payments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.proposal_payments
  ADD COLUMN IF NOT EXISTS reference text;

-- Allow online card / bank methods in addition to cash/check/other.
ALTER TABLE public.proposal_payments DROP CONSTRAINT IF EXISTS proposal_payments_method_check;
ALTER TABLE public.proposal_payments ADD CONSTRAINT proposal_payments_method_check
  CHECK (method = ANY (ARRAY['cash'::text,'check'::text,'other'::text,'cc'::text,'ach'::text]));

-- Avoid double-recording the same online charge.
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_payments_ref
  ON public.proposal_payments(proposal_id, reference)
  WHERE reference IS NOT NULL;

NOTIFY pgrst, 'reload schema';
