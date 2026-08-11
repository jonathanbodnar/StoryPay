-- Migration 201: Per-person Venue Direct notification preferences
--
-- Lets each individual person — the account owner, and each team member
-- separately — control whether THEY personally get the Venue Direct email
-- and/or SMS nudge when the concierge team hands off a bride conversation.
-- Defaults to true/true so nobody's notifications change until they
-- explicitly flip one off from Settings -> Push Notifications.
--
-- The owner is a single person per venue (no separate "owner" row exists
-- outside `venues` itself), so their two prefs live directly on `venues`.
-- Each team member already has their own row in `venue_team_members`, so
-- theirs live there.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS owner_venue_direct_email_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS owner_venue_direct_sms_enabled   BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE venue_team_members
  ADD COLUMN IF NOT EXISTS venue_direct_email_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS venue_direct_sms_enabled   BOOLEAN NOT NULL DEFAULT true;
