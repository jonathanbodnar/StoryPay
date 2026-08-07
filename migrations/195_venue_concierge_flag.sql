-- Migration 195: Add venue_concierge feature flag
--
-- venue_concierge (BOOLEAN, default false) enables full concierge routing for
-- a venue. BOTH is_private_client AND venue_concierge must be true for
-- concierge features (bride reply routing, support inbox management) to activate.
-- is_private_client alone remains a tracking/watch-list tag only.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS venue_concierge BOOLEAN NOT NULL DEFAULT FALSE;
