-- GHL contact sync — track when GHL contacts were last pulled into our DB.
-- This lets every venue's contacts live in StoryVenue's database so we never
-- lose them if GHL is disconnected or cancelled.

-- Per-venue sync timestamp (used by cron to find venues that need re-syncing).
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS ghl_contacts_synced_at TIMESTAMPTZ;

-- Per-customer sync timestamp (helps debug & lets us spot stale records).
ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS ghl_synced_at TIMESTAMPTZ;

-- Make (venue_id, ghl_contact_id) uniquely indexed so we can upsert safely.
-- Replaces the existing non-unique partial index from migration 040.
DROP INDEX IF EXISTS public.venue_customers_venue_ghl_contact_idx;
CREATE UNIQUE INDEX IF NOT EXISTS venue_customers_venue_ghl_contact_uniq
  ON public.venue_customers (venue_id, ghl_contact_id)
  WHERE ghl_contact_id IS NOT NULL;

-- Helpful index for cron queries that scan venues needing a sync.
CREATE INDEX IF NOT EXISTS venues_ghl_connected_idx
  ON public.venues (ghl_connected)
  WHERE ghl_connected = TRUE;
