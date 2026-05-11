-- Track when a proposal was refunded so reports can show refund dates
-- and sort by refund date instead of original paid date.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

COMMENT ON COLUMN public.proposals.refunded_at IS
  'Timestamp when the proposal was refunded (full or partial).';
