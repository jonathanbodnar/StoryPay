-- Migration 203: Split the merged "Bride needs you" preference back into
-- two independent scenarios — `ai_handoff` (AI Concierge auto-escalates)
-- and `venue_direct` (concierge team manually sends a Venue Direct
-- message). Migration 202 had merged these into one shared
-- `email_bride_handoff` / `sms_bride_handoff` preference; this carries
-- those existing per-person choices forward into `venue_direct` (the
-- scenario they were originally built for back in migration 201), while
-- `ai_handoff` starts fresh on the default true/true (it was never
-- individually customizable before now — see src/lib/notification-settings.ts).
--
-- The old `email_bride_handoff` / `sms_bride_handoff` keys are left in
-- place (unused going forward) rather than removed, so this migration is
-- purely additive and safe to re-run.

UPDATE venues
SET notification_settings = notification_settings
  || jsonb_build_object('email_venue_direct', notification_settings->'email_bride_handoff')
  || jsonb_build_object('sms_venue_direct', notification_settings->'sms_bride_handoff')
WHERE notification_settings ? 'email_bride_handoff'
   OR notification_settings ? 'sms_bride_handoff';

UPDATE venue_team_members
SET notification_settings = notification_settings
  || jsonb_build_object('email_venue_direct', notification_settings->'email_bride_handoff')
  || jsonb_build_object('sms_venue_direct', notification_settings->'sms_bride_handoff')
WHERE notification_settings ? 'email_bride_handoff'
   OR notification_settings ? 'sms_bride_handoff';
