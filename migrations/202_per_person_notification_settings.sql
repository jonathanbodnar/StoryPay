-- Migration 202: Per-person notification settings (email + SMS)
--
-- Generalizes migration 201's one-off Venue Direct email/SMS columns into a
-- single flexible per-person settings blob that covers every owner/team
-- alert type (new lead, payment received/failed, bride handoff, proposal
-- signed, etc.) — not just Venue Direct. Each person (the account owner, and
-- each team member independently) gets their own JSON bag of
-- `email_<scenario>` / `sms_<scenario>` booleans, read/written via
-- /api/profile/notifications. Unset keys fall back to sensible defaults in
-- code (see src/lib/notification-settings.ts) so nothing needs backfilling
-- for scenarios nobody has touched yet.
--
-- The one exception is Venue Direct / AI Concierge handoff, which already
-- had real per-person toggles with real user-set values (migration 201) —
-- those get carried forward into the new `email_bride_handoff` /
-- `sms_bride_handoff` keys so nobody's existing choice is lost. The old
-- migration-201 columns are left in place (unused going forward) rather than
-- dropped, so this migration is purely additive and safe to re-run.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS notification_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE venue_team_members
  ADD COLUMN IF NOT EXISTS notification_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Carry forward existing Venue Direct per-person choices from migration 201.
UPDATE venues
SET notification_settings = notification_settings
  || jsonb_build_object('email_bride_handoff', owner_venue_direct_email_enabled)
  || jsonb_build_object('sms_bride_handoff', owner_venue_direct_sms_enabled)
WHERE owner_venue_direct_email_enabled IS NOT NULL
   OR owner_venue_direct_sms_enabled IS NOT NULL;

UPDATE venue_team_members
SET notification_settings = notification_settings
  || jsonb_build_object('email_bride_handoff', venue_direct_email_enabled)
  || jsonb_build_object('sms_bride_handoff', venue_direct_sms_enabled)
WHERE venue_direct_email_enabled IS NOT NULL
   OR venue_direct_sms_enabled IS NOT NULL;
