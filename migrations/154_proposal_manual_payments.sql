-- Manual (cash / check) payment tracking for proposals & invoices.
--
-- Venue owners can collect payment directly from a client (cash or check, in
-- person) instead of — or in addition to — the online StoryPay checkout. A
-- single proposal/invoice may have multiple manual payments recorded against
-- it (deposit + balance, etc.), so we track them in a child ledger table and
-- derive the running balance from SUM(amount_cents).

-- 1. Per-payment ledger.
CREATE TABLE IF NOT EXISTS public.proposal_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  venue_id     uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  method       text NOT NULL DEFAULT 'cash' CHECK (method = ANY (ARRAY['cash'::text,'check'::text,'other'::text])),
  check_number text,
  note         text,
  recorded_by  text,
  paid_at      timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposal_payments_proposal ON public.proposal_payments(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_payments_venue ON public.proposal_payments(venue_id);

-- 2. Per-proposal flags.
--    collect_manually  → suppress the online payment form; owner collects cash/check.
--    require_signature → owner can send a doc the client signs in person (no e-sign).
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS collect_manually boolean NOT NULL DEFAULT false;
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS require_signature boolean NOT NULL DEFAULT true;

-- 3. Allow a 'partially_paid' status for invoices/proposals with an outstanding
--    balance after one or more manual payments.
ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text,
    'sent'::text,
    'opened'::text,
    'signed'::text,
    'paid'::text,
    'partially_paid'::text,
    'refunded'::text,
    'partial_refund'::text,
    'expired'::text,
    'cancelled'::text,
    'declined'::text
  ]));

NOTIFY pgrst, 'reload schema';
