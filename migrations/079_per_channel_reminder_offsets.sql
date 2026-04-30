-- ─────────────────────────────────────────────────────────────────────────────
-- 079 · Per-channel reminder timing + channel tag on reminder queue rows
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Per-channel reminder offsets on notification templates ─────────────────
-- Stores [{d,h,m}] for each reminder channel independently so Email→Owner,
-- Email→Contact, SMS→Owner, SMS→Contact can each fire at different times.
ALTER TABLE public.venue_calendar_notifications
  ADD COLUMN IF NOT EXISTS reminder_offsets jsonb;

-- ── 2. Tag reminder queue rows with the specific channel they target ──────────
ALTER TABLE public.calendar_event_reminders
  ADD COLUMN IF NOT EXISTS channel text;

-- Drop the old unique constraint (calendar_event_id, reminder_index) because
-- the same reminder_index can now appear for different channels.
ALTER TABLE public.calendar_event_reminders
  DROP CONSTRAINT IF EXISTS calendar_event_reminders_event_idx_uidx;

-- Per-channel unique: (event, channel, index)
CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_reminders_event_ch_idx_uidx
  ON public.calendar_event_reminders (calendar_event_id, channel, reminder_index)
  WHERE channel IS NOT NULL;

-- Backward-compat: legacy rows without a channel keep the old uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_reminders_event_idx_legacy_uidx
  ON public.calendar_event_reminders (calendar_event_id, reminder_index)
  WHERE channel IS NULL;

-- ── 3. Seed per-channel default reminder offsets for existing rows ─────────────
-- Email channels: 1 day + 1 hour + 10 minutes
UPDATE public.venue_calendar_notifications
SET reminder_offsets = '[{"d":1,"h":0,"m":0},{"d":0,"h":1,"m":0},{"d":0,"h":0,"m":10}]'::jsonb
WHERE notification_type = 'reminder'
  AND channel IN ('email_owner', 'email_contact')
  AND reminder_offsets IS NULL;

-- SMS channels: 1 hour + 10 minutes (shorter set — SMS should be concise)
UPDATE public.venue_calendar_notifications
SET reminder_offsets = '[{"d":0,"h":1,"m":0},{"d":0,"h":0,"m":10}]'::jsonb
WHERE notification_type = 'reminder'
  AND channel IN ('sms_owner', 'sms_contact')
  AND reminder_offsets IS NULL;

NOTIFY pgrst, 'reload schema';
