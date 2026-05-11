-- Drop the old constraint that only allowed draft/sent/opened/signed/paid
-- and add a new one that includes refunded, partial_refund, and other
-- terminal statuses used by the billing and proposal flows.

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_status_check;

ALTER TABLE public.proposals ADD CONSTRAINT proposals_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text,
    'sent'::text,
    'opened'::text,
    'signed'::text,
    'paid'::text,
    'refunded'::text,
    'partial_refund'::text,
    'expired'::text,
    'cancelled'::text,
    'declined'::text
  ]));
