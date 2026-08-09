-- Migration 198: Add phone column to venue_team_members
--
-- Lets venue owners collect a mobile number for each team member (required
-- going forward for new adds, optional/backfillable for existing members),
-- so the concierge team can SMS any team member from Support Inbox ->
-- Private Clients / the venue contact card, the same way it already can
-- for account owners.

ALTER TABLE venue_team_members
  ADD COLUMN IF NOT EXISTS phone TEXT;
