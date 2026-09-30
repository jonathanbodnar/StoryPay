-- Payment plans: safer automatic payments, and overdue reminders that work.
-- Additive only.

-- ── Automatic payments (proposal_installments, from 263) ────────────────────
-- planned_amount_cents: the amount in the plan the couple agreed to. When a
--   check or cash payment covers part of the plan, the next payments are
--   trimmed; if that payment is removed, they go back toward this amount.
-- canceled_reason: why a payment was canceled ('covered' = paid another way,
--   'plan_canceled' = the venue stopped the plan).
-- heads_up_sent_at: when the "your payment is coming up" email went out.
alter table public.proposal_installments add column if not exists planned_amount_cents int;
alter table public.proposal_installments add column if not exists canceled_reason text;
alter table public.proposal_installments add column if not exists heads_up_sent_at timestamptz;
update public.proposal_installments set planned_amount_cents = amount_cents where planned_amount_cents is null;

-- ── Overdue payment reminders ───────────────────────────────────────────────
-- Migration 023 was never applied in production, so these reminders never
-- went out and the Notifications setting couldn't save. Same table as 023;
-- the default offsets are 1, 3 and 7 days AFTER a missed due date, which is
-- what the code sends.
alter table public.venues
  add column if not exists payment_reminders_enabled boolean not null default true;
alter table public.venues
  add column if not exists payment_reminder_offsets jsonb not null
  default '[{"d":1,"h":0,"m":0},{"d":3,"h":0,"m":0},{"d":7,"h":0,"m":0}]'::jsonb;

comment on column public.venues.payment_reminders_enabled is
  'Email the client when a payment is overdue (manual-collection plans, unpaid first payments, invoices with a due date).';
comment on column public.venues.payment_reminder_offsets is
  'Up to 3 {d,h,m}: send this long AFTER the due date if still unpaid.';

create table if not exists public.proposal_payment_reminders (
  id                       uuid primary key default gen_random_uuid(),
  proposal_id              uuid not null references public.proposals(id) on delete cascade,
  venue_id                 uuid not null references public.venues(id) on delete cascade,
  installment_index        integer not null,
  reminder_index           integer not null,
  offset_days              integer not null default 0,
  offset_hours             integer not null default 0,
  offset_minutes           integer not null default 0,
  send_at                  timestamptz not null,
  due_at                   timestamptz not null,
  installment_amount_cents integer,
  sent_at                  timestamptz,
  created_at               timestamptz not null default now(),
  constraint proposal_payment_reminders_reminder_idx_chk check (reminder_index >= 0 and reminder_index < 3),
  constraint proposal_payment_reminders_offset_nonneg check (offset_days >= 0 and offset_hours >= 0 and offset_minutes >= 0),
  constraint proposal_payment_reminders_unique unique (proposal_id, installment_index, reminder_index)
);

create index if not exists proposal_payment_reminders_due_idx
  on public.proposal_payment_reminders (send_at) where sent_at is null;
create index if not exists proposal_payment_reminders_venue_id_idx
  on public.proposal_payment_reminders (venue_id);
create index if not exists proposal_payment_reminders_proposal_id_idx
  on public.proposal_payment_reminders (proposal_id);

-- Server-only, like the other payment tables.
alter table public.proposal_payment_reminders enable row level security;
revoke all on public.proposal_payment_reminders from anon, authenticated;

notify pgrst, 'reload schema';
