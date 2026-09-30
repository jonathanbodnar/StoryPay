-- Refunds on individual payments. Additive only.
--
-- A refund is recorded on the payment it came from: refunded_cents is read
-- back from Stripe (the charge's amount_refunded), so a refund issued in the
-- app and one issued in the venue's own Stripe dashboard land the same way and
-- are never counted twice. Balances keep summing amount_cents: a refund is a
-- credit to the couple, never charged again. Money actually kept by the venue
-- is amount_cents - refunded_cents.
alter table public.proposal_payments add column if not exists refunded_cents integer not null default 0;
alter table public.proposal_payments add column if not exists refunded_at timestamptz;
alter table public.proposal_payments drop constraint if exists proposal_payments_refunded_range;
alter table public.proposal_payments
  add constraint proposal_payments_refunded_range check (refunded_cents >= 0 and refunded_cents <= amount_cents);

notify pgrst, 'reload schema';
