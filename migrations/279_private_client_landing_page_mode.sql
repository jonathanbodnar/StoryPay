-- 279: Private Client implies landing page mode (owner's rule, Oct 4 2026).
-- Landing page mode was only ever a plan-level flag
-- (directory_plans.hide_header); the Venue Management "Private Client"
-- checkbox has sent a per-venue landing_page_mode field since it was built,
-- but the column never existed, so it silently vanished. Now: the column
-- exists, every venue already labeled Private Client gets it switched on,
-- and the directory may read it (it joins the reviewed public-read
-- contract in tests/flows/locked-database.test.ts).
--
-- Idempotent — safe to run multiple times.
alter table public.venues
  add column if not exists landing_page_mode boolean not null default false;

update public.venues
  set landing_page_mode = true
  where is_private_client = true and landing_page_mode = false;

grant select (landing_page_mode) on public.venues to anon, authenticated;

NOTIFY pgrst, 'reload schema';
