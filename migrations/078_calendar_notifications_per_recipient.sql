-- ─────────────────────────────────────────────────────────────────────────────
-- 078 · Calendar notifications per-recipient channels + follow-up scheduling
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Drop the old channel CHECK so we can use email_owner / email_contact /
--       sms_owner / sms_contact as channel values ────────────────────────────
ALTER TABLE public.venue_calendar_notifications
  DROP CONSTRAINT IF EXISTS venue_calendar_notifications_channel_check;

-- ── 2. Add notification_type column to calendar_event_reminders so one table
--       can hold both reminder and follow-up queued sends ────────────────────
ALTER TABLE public.calendar_event_reminders
  ADD COLUMN IF NOT EXISTS notification_type text NOT NULL DEFAULT 'reminder';

-- Relax reminder_index upper-bound so follow-ups can use index 98/99
ALTER TABLE public.calendar_event_reminders
  DROP CONSTRAINT IF EXISTS calendar_event_reminders_index_chk;
ALTER TABLE public.calendar_event_reminders
  ADD CONSTRAINT calendar_event_reminders_index_chk
    CHECK (reminder_index >= 0 AND reminder_index < 100);

-- ── 3. Seed per-recipient template rows for every existing venue ──────────────
--       Uses ON CONFLICT DO NOTHING so existing customized rows are preserved.
INSERT INTO public.venue_calendar_notifications
  (venue_id, notification_type, channel, enabled,
   notify_contact, notify_assigned, subject, body)
SELECT
  v.id,
  n.notification_type,
  n.channel,
  n.enabled,
  n.notify_contact,
  n.notify_assigned,
  n.subject,
  n.body
FROM public.venues v
CROSS JOIN (VALUES
  -- ── booked_confirmed ────────────────────────────────────────────────────────
  ('booked_confirmed','email_owner', true, false, false,
   'New Booking: {{appointment.title}} with {{contact.name}}',
   E'Hi,\n\nA new appointment has been confirmed.\n\nContact: {{contact.name}} ({{contact.email}})\nPhone: {{contact.phone}}\nTitle: {{appointment.title}}\nDate & Time: {{appointment.start_time}} ({{appointment.timezone}})\nLocation: {{appointment.meeting_location}}\n\n— {{venue.name}}'
  ),
  ('booked_confirmed','email_contact', true, true, false,
   'Confirmed! Your {{appointment.title}} on {{appointment.start_time}} ({{appointment.timezone}})',
   E'Hi {{contact.name}},\n\nYour appointment has been confirmed. Here are the details:\n\nAppointment Title: {{appointment.title}}\nDate and Time: {{appointment.start_time}} ({{appointment.timezone}})\nMeeting Link / Location: {{appointment.meeting_location}}\n\nWe look forward to connecting with you!\n\n{{venue.name}}'
  ),
  ('booked_confirmed','sms_owner', false, false, false,
   null,
   'New booking: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}} ({{appointment.timezone}}).'
  ),
  ('booked_confirmed','sms_contact', true, true, false,
   null,
   'Hi {{contact.name}}, your appointment "{{appointment.title}}" is confirmed for {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}'
  ),
  -- ── cancellation ────────────────────────────────────────────────────────────
  ('cancellation','email_owner', true, false, false,
   'Cancelled: {{appointment.title}} with {{contact.name}}',
   E'Hi,\n\nThe following appointment has been cancelled:\n\nContact: {{contact.name}} ({{contact.email}})\nTitle: {{appointment.title}}\nDate: {{appointment.start_time}} ({{appointment.timezone}})\n\n— {{venue.name}}'
  ),
  ('cancellation','email_contact', true, true, false,
   'Your Appointment Has Been Cancelled',
   E'Hi {{contact.name}},\n\nYour appointment "{{appointment.title}}" scheduled for {{appointment.start_time}} ({{appointment.timezone}}) has been cancelled.\n\nIf you would like to reschedule, please reach out to us.\n\n{{venue.name}}'
  ),
  ('cancellation','sms_owner', false, false, false,
   null,
   'Cancelled: {{appointment.title}} with {{contact.name}} (was {{appointment.start_time}}).'
  ),
  ('cancellation','sms_contact', true, true, false,
   null,
   'Hi {{contact.name}}, your appointment "{{appointment.title}}" on {{appointment.start_time}} has been cancelled. Contact us to reschedule.'
  ),
  -- ── reschedule ──────────────────────────────────────────────────────────────
  ('reschedule','email_owner', true, false, false,
   'Rescheduled: {{appointment.title}} with {{contact.name}}',
   E'Hi,\n\nAn appointment has been rescheduled:\n\nContact: {{contact.name}} ({{contact.email}})\nTitle: {{appointment.title}}\nNew Date & Time: {{appointment.start_time}} ({{appointment.timezone}})\nLocation: {{appointment.meeting_location}}\n\n— {{venue.name}}'
  ),
  ('reschedule','email_contact', true, true, false,
   'Your Appointment Has Been Rescheduled',
   E'Hi {{contact.name}},\n\nYour appointment "{{appointment.title}}" has been rescheduled to:\n\nDate & Time: {{appointment.start_time}} ({{appointment.timezone}})\nLocation: {{appointment.meeting_location}}\n\n{{venue.name}}'
  ),
  ('reschedule','sms_owner', false, false, false,
   null,
   'Rescheduled: {{appointment.title}} with {{contact.name}} → {{appointment.start_time}} ({{appointment.timezone}}).'
  ),
  ('reschedule','sms_contact', true, true, false,
   null,
   'Hi {{contact.name}}, your appointment "{{appointment.title}}" has been rescheduled to {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}'
  ),
  -- ── reminder ────────────────────────────────────────────────────────────────
  ('reminder','email_owner', true, false, false,
   'Upcoming Appointment: {{appointment.title}} with {{contact.name}}',
   E'Hi,\n\nReminder: you have an upcoming appointment.\n\nContact: {{contact.name}} ({{contact.email}})\nTitle: {{appointment.title}}\nDate & Time: {{appointment.start_time}} ({{appointment.timezone}})\nLocation: {{appointment.meeting_location}}\n\n— {{venue.name}}'
  ),
  ('reminder','email_contact', true, true, false,
   'Reminder: Your Appointment — {{appointment.title}}',
   E'Hi {{contact.name}},\n\nThis is a reminder for your upcoming appointment:\n\nAppointment Title: {{appointment.title}}\nDate and Time: {{appointment.start_time}} ({{appointment.timezone}})\nMeeting Link / Location: {{appointment.meeting_location}}\n\nWe look forward to speaking with you!\n\n{{venue.name}}'
  ),
  ('reminder','sms_owner', false, false, false,
   null,
   'Reminder: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}} ({{appointment.timezone}}).'
  ),
  ('reminder','sms_contact', true, true, false,
   null,
   'Hi {{contact.name}}, reminder: "{{appointment.title}}" is on {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}'
  ),
  -- ── follow_up ───────────────────────────────────────────────────────────────
  ('follow_up','email_owner', true, false, false,
   'Follow-Up: {{appointment.title}} with {{contact.name}} completed',
   E'Hi,\n\nThe following appointment has been completed:\n\nContact: {{contact.name}} ({{contact.email}})\nTitle: {{appointment.title}}\nDate: {{appointment.start_time}} ({{appointment.timezone}})\n\n— {{venue.name}}'
  ),
  ('follow_up','email_contact', true, true, false,
   'Thank You — {{appointment.title}}',
   E'Hi {{contact.name}},\n\nThank you for your appointment "{{appointment.title}}" on {{appointment.start_time}}.\n\nWe hope it was valuable! Please don''t hesitate to reach out if you have any questions.\n\n{{venue.name}}'
  ),
  ('follow_up','sms_owner', false, false, false,
   null,
   'Completed: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}}.'
  ),
  ('follow_up','sms_contact', true, true, false,
   null,
   'Hi {{contact.name}}, thanks for your appointment "{{appointment.title}}"! Feel free to reach out with any questions. — {{venue.name}}'
  )
) AS n(notification_type, channel, enabled, notify_contact, notify_assigned, subject, body)
ON CONFLICT (venue_id, notification_type, channel) DO NOTHING;

NOTIFY pgrst, 'reload schema';
