-- Migration 167: Tripleseat integration credentials per venue
-- Adds two nullable columns to venues:
--   tripleseat_public_key  — the venue's Tripleseat public API key
--   tripleseat_location_id — the numeric Tripleseat location ID to assign leads to
-- Both are nullable; NULL means the integration is not connected.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS tripleseat_public_key  TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tripleseat_location_id INTEGER     DEFAULT NULL;
