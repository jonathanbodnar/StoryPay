-- 263: Venue payments on Stripe Connect
--
-- Each venue connects its own Stripe account (Accounts v2: full Stripe
-- Dashboard, Stripe collects Stripe's fees from the venue and carries losses).
-- Couples pay the venue directly (direct charges); StoryVenue's cut is an
-- application fee. LunarPay keeps working for venues until they connect Stripe.
--
-- Additive and safe to re-run.

-- ── Venues ────────────────────────────────────────────────────────────────
alter table public.venues add column if not exists stripe_account_id text;
-- onboarding | pending | active | restricted  (null = never started)
alter table public.venues add column if not exists stripe_account_status text;
alter table public.venues add column if not exists stripe_charges_enabled boolean not null default false;
alter table public.venues add column if not exists stripe_account_synced_at timestamptz;
-- Which processor takes the venue's couple payments. Set to 'stripe' once the
-- venue's Stripe account can accept payments.
alter table public.venues add column if not exists payments_provider text;
-- Per-venue overrides of the tier fee schedule (e.g. 0 for a private client).
alter table public.venues add column if not exists payment_fee_card_percent numeric;
alter table public.venues add column if not exists payment_fee_bank_percent numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'venues_payments_provider_check') then
    alter table public.venues
      add constraint venues_payments_provider_check check (payments_provider in ('lunarpay', 'stripe'));
  end if;
end $$;

create unique index if not exists venues_stripe_account_id_key
  on public.venues (stripe_account_id) where stripe_account_id is not null;

-- The venue's default "Service fee" on new invoices and proposals: 3.5%
-- (was a hard-coded 2.75% "processing fee"). Venues that never changed it move
-- to the new default; anyone who set their own rate keeps it.
alter table public.venues alter column service_fee_rate set default 3.5;
update public.venues set service_fee_rate = 3.5 where service_fee_rate = 2.75;

-- ── StoryVenue's fee schedule (admin-adjustable) ───────────────────────────
-- card_fee_percent:   StoryVenue's cut on any card, on top of Stripe's 2.9% + 30¢.
-- bank_total_percent: the venue's all-in rate on a bank (ACH) payment; StoryVenue
--                     keeps it minus Stripe's ACH fee (0.8%, max $5).
create table if not exists public.platform_payment_fee_tiers (
  tier text primary key check (tier in ('paid', 'free')),
  card_fee_percent numeric not null,
  bank_total_percent numeric not null,
  updated_at timestamptz not null default now()
);
insert into public.platform_payment_fee_tiers (tier, card_fee_percent, bank_total_percent)
values ('paid', 0.5, 1.0), ('free', 1.0, 1.5)
on conflict (tier) do nothing;
alter table public.platform_payment_fee_tiers enable row level security;

-- ── Proposals / invoices ──────────────────────────────────────────────────
alter table public.proposals add column if not exists payment_provider text;
alter table public.proposals add column if not exists stripe_customer_id text;
alter table public.proposals add column if not exists stripe_payment_method_id text;
alter table public.proposals add column if not exists stripe_payment_intent_id text;
-- A bank (ACH) payment that Stripe is still settling (3–5 business days).
alter table public.proposals add column if not exists payment_processing_at timestamptz;

create index if not exists proposals_stripe_payment_intent_id_idx
  on public.proposals (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- ── Installments charged automatically on their due date (Stripe) ──────────
-- One row per payment after the first (the first is paid at checkout).
create table if not exists public.proposal_installments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  installment_number int not null,
  installment_count int not null,
  due_date date not null,
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'paid', 'failed', 'canceled')),
  attempts int not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proposal_id, installment_number)
);
create index if not exists proposal_installments_due_idx
  on public.proposal_installments (next_attempt_at) where status = 'scheduled';
create index if not exists proposal_installments_venue_idx
  on public.proposal_installments (venue_id);
alter table public.proposal_installments enable row level security;

-- ── Webhook dedupe: events from connected accounts carry their account ─────
alter table public.stripe_events add column if not exists account text;
