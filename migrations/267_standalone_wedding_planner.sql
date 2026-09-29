-- 267: The Wedding Planner works without a venue; wedding website view counts
--
-- Brides plan on their own: many venues aren't on StoryVenue, so connecting a
-- venue is optional. Each couple gets a planner row with no venue (status
-- 'self'). When they connect a venue, the venue is attached to that same row,
-- so the guest list, budget and everything else stay put. When the venue
-- declines or the couple disconnects, the row goes back to 'self'
-- (lib/couple-weddings.ts).
--
-- The public wedding website counts its views per day (couple_site_views),
-- shown on the couple's planner home.
--
-- Safe to re-run.

-- 1) Planner rows without a venue
alter table public.couple_weddings alter column venue_id drop not null;

alter table public.couple_weddings drop constraint if exists couple_weddings_status_check;
alter table public.couple_weddings add constraint couple_weddings_status_check
  check (status = any (array['self'::text, 'pending'::text, 'linked'::text, 'declined'::text, 'revoked'::text]));

-- A 'self' planner belongs to a couple and has no venue; every other status has a venue.
alter table public.couple_weddings drop constraint if exists couple_weddings_venue_by_status_chk;
alter table public.couple_weddings add constraint couple_weddings_venue_by_status_chk
  check ((status = 'self' and couple_id is not null and venue_id is null) or (status <> 'self' and venue_id is not null));

-- One self planner per couple.
create unique index if not exists couple_weddings_one_self_per_couple
  on public.couple_weddings (couple_id) where status = 'self';

-- Guests of a planner with no venue.
alter table public.wedding_guests alter column venue_id drop not null;

-- 2) Wedding website views, per day
create table if not exists public.couple_site_views (
  site_id uuid not null references public.couple_sites(id) on delete cascade,
  day date not null,
  views integer not null default 0,
  primary key (site_id, day)
);
alter table public.couple_site_views enable row level security;

create or replace function public.increment_couple_site_view(p_site_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.couple_site_views (site_id, day, views)
  values (p_site_id, (now() at time zone 'utc')::date, 1)
  on conflict (site_id, day) do update set views = couple_site_views.views + 1;
$$;
revoke all on function public.increment_couple_site_view(uuid) from public, anon, authenticated;
