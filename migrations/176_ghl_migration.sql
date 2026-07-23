-- Migration 176: GHL → StoryVenue contact migration support
--
-- Adds an `is_ghl_migration` flag to leads and venue_customers so that
-- contacts imported from Go High Level can be permanently exempted from
-- automated Speed-to-Lead / 14-day drip sequences (automations should
-- never fire retroactively for migrated contacts).

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS is_ghl_migration boolean NOT NULL DEFAULT false;

ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS is_ghl_migration boolean NOT NULL DEFAULT false;

-- Sparse index — the vast majority of rows will be false, so index only
-- the migrated contacts for fast admin queries.
CREATE INDEX IF NOT EXISTS leads_is_ghl_migration_idx
  ON public.leads (venue_id, is_ghl_migration)
  WHERE is_ghl_migration = true;

CREATE INDEX IF NOT EXISTS venue_customers_is_ghl_migration_idx
  ON public.venue_customers (venue_id, is_ghl_migration)
  WHERE is_ghl_migration = true;
