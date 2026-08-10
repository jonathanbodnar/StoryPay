-- Migration 199: Track inbound SMS replies to concierge direct messages
--
-- When the concierge team texts a venue owner or team member directly
-- (Support Inbox -> Private Clients, or the venue contact card on a
-- bride/lead thread), any SMS reply they send back was previously
-- invisible: private_client_messages was outbound-only, and nothing
-- polled GHL for these specific contacts. This adds:
--   - a cached GHL contact id per recipient, so a background poller can
--     check for replies without re-searching GHL every tick
--   - direction + ghl_message_id on private_client_messages so inbound
--     replies can be recorded and deduped alongside the outbound log

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS owner_concierge_ghl_contact_id TEXT;

ALTER TABLE venue_team_members
  ADD COLUMN IF NOT EXISTS concierge_ghl_contact_id TEXT;

ALTER TABLE private_client_messages
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS ghl_message_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'private_client_messages_direction_check'
  ) THEN
    ALTER TABLE private_client_messages
      ADD CONSTRAINT private_client_messages_direction_check
      CHECK (direction IN ('outbound', 'inbound'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_private_client_messages_ghl_message_id
  ON private_client_messages (ghl_message_id)
  WHERE ghl_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_private_client_messages_venue_created
  ON private_client_messages (venue_id, created_at DESC);
