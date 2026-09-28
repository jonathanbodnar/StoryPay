-- 262: StoryVenue SaaS billing on the owner's Stripe account
--
-- Venues pay the software subscription through either LunarPay (legacy, until
-- each venue is moved) or Stripe. `billing_provider` says which; every billing
-- entry point branches on it. For Stripe venues `directory_subscription_external_id`
-- also holds the Stripe subscription id, so the existing dashboard gates
-- ("has a subscription on file") keep working unchanged.
--
-- Additive and safe to re-run.

alter table public.venues add column if not exists billing_provider text;
alter table public.venues add column if not exists stripe_customer_id text;
alter table public.venues add column if not exists stripe_subscription_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'venues_billing_provider_check') then
    alter table public.venues
      add constraint venues_billing_provider_check check (billing_provider in ('lunarpay', 'stripe'));
  end if;
end $$;

-- Not unique: one owner (one Stripe customer) can run several venues, each with
-- its own software subscription.
create index if not exists venues_stripe_customer_id_idx
  on public.venues (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists venues_stripe_subscription_id_key
  on public.venues (stripe_subscription_id) where stripe_subscription_id is not null;

-- Everyone billing on LunarPay today.
update public.venues
   set billing_provider = 'lunarpay'
 where billing_provider is null
   and directory_subscription_external_id is not null;

alter table public.platform_addon_prices add column if not exists stripe_price_id text;

alter table public.platform_billing_events add column if not exists provider text;
alter table public.platform_billing_events add column if not exists stripe_invoice_id text;

-- One row per Stripe webhook event, so a retried delivery is processed once.
create table if not exists public.stripe_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);
alter table public.stripe_events enable row level security;
