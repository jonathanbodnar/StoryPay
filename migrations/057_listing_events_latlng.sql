-- Listing analytics: add coordinates so the realtime visitor map can plot
-- points without a separate geocoding step. lat/lng come from the same
-- ip-api.com lookup that already fills country/region/city.
BEGIN;

ALTER TABLE public.listing_events
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- We occasionally need "active visitors within bounding box" queries to
-- drive the live map when a single venue has many concurrent visitors.
-- A compound btree on (venue_id, created_at, latitude, longitude) is
-- overkill — realtime already filters by venue+recency, so a simple index
-- on (venue_id, created_at) combined with latitude IS NOT NULL handles it.
CREATE INDEX IF NOT EXISTS listing_events_geo_live_idx
  ON public.listing_events (venue_id, created_at DESC)
  WHERE latitude IS NOT NULL;

COMMIT;
