-- Migration 215: Event Temple integration credentials per venue
-- Adds two nullable columns to venues:
--   eventtemple_api_key — the venue user's Event Temple API key (Settings → Developers → API)
--   eventtemple_org_id  — the Event Temple API-ORG identifier for the organization
--                         (Settings → Overview → API-ORG) that requests are scoped to
-- Both are nullable; NULL means the integration is not connected.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS eventtemple_api_key TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS eventtemple_org_id  TEXT DEFAULT NULL;
