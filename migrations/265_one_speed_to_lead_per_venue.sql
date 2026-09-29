-- 265: At most one "Speed to Lead — Booking System" automation per venue
--
-- The Booking System's 14-day sequence is on by default, and the app now
-- creates it automatically when a venue's first lead arrives
-- (lib/booking-system-default-sequence.ts). Two leads landing at the same
-- moment must not create it twice, or couples would get every text twice, so
-- the second insert fails here and is ignored.
--
-- Safe to re-run.

create unique index if not exists marketing_automations_one_stl_per_venue
  on public.marketing_automations (venue_id)
  where name = 'Speed to Lead — Booking System';
