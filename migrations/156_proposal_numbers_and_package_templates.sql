-- Migration 156:
--   1. Sequential, human-friendly proposal/invoice numbers (e.g. #1042) so
--      owners & couples can reference a booking instead of a random token slice.
--   2. Link a venue package to a default contract template so picking a package
--      in the proposal builder can auto-fill both line items AND the contract.
--
-- Idempotent. The `proposals` and `proposal_templates` tables predate the
-- migration series (preserved by 001), so everything is guarded.

-- 1. Sequential proposal number ------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.proposal_number_seq START 1001;

ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS proposal_number bigint;
ALTER TABLE public.proposals ALTER COLUMN proposal_number SET DEFAULT nextval('public.proposal_number_seq');

-- Backfill existing rows in creation order so older bookings get lower numbers.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.proposals WHERE proposal_number IS NULL ORDER BY created_at LOOP
    UPDATE public.proposals SET proposal_number = nextval('public.proposal_number_seq') WHERE id = r.id;
  END LOOP;
END $$;

-- 2. Package -> default contract template --------------------------------------
ALTER TABLE public.venue_packages
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.proposal_templates(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
