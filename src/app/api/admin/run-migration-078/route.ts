import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

/**
 * GET/POST /api/admin/run-migration-078
 *
 * 1. Drops the channel CHECK constraint on venue_calendar_notifications so
 *    per-recipient channels (email_owner, email_contact, sms_owner, sms_contact)
 *    are valid values.
 * 2. Adds notification_type column to calendar_event_reminders (default 'reminder')
 *    and widens the reminder_index CHECK to allow follow-up rows (index 98/99).
 * 3. Seeds per-recipient notification template rows for every existing venue.
 */
export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    // ── 1. Relax channel constraint ──────────────────────────────────────────
    await sql`
      ALTER TABLE public.venue_calendar_notifications
        DROP CONSTRAINT IF EXISTS venue_calendar_notifications_channel_check
    `;

    // ── 2. Add notification_type to reminder queue ────────────────────────────
    await sql`
      ALTER TABLE public.calendar_event_reminders
        ADD COLUMN IF NOT EXISTS notification_type text NOT NULL DEFAULT 'reminder'
    `;

    await sql`
      ALTER TABLE public.calendar_event_reminders
        DROP CONSTRAINT IF EXISTS calendar_event_reminders_index_chk
    `;
    await sql`
      ALTER TABLE public.calendar_event_reminders
        ADD CONSTRAINT calendar_event_reminders_index_chk
          CHECK (reminder_index >= 0 AND reminder_index < 100)
    `;

    // ── 3. Seed per-recipient rows ────────────────────────────────────────────
    await sql`
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
        ('booked_confirmed','email_owner', true, false, false,
         'New Booking: {{appointment.title}} with {{contact.name}}',
         'Hi,' || chr(10) || chr(10) || 'A new appointment has been confirmed.' || chr(10) || chr(10) || 'Contact: {{contact.name}} ({{contact.email}})' || chr(10) || 'Phone: {{contact.phone}}' || chr(10) || 'Title: {{appointment.title}}' || chr(10) || 'Date & Time: {{appointment.start_time}} ({{appointment.timezone}})' || chr(10) || 'Location: {{appointment.meeting_location}}' || chr(10) || chr(10) || '— {{venue.name}}'
        ),
        ('booked_confirmed','email_contact', true, true, false,
         'Confirmed! Your {{appointment.title}} on {{appointment.start_time}} ({{appointment.timezone}})',
         'Hi {{contact.name}},' || chr(10) || chr(10) || 'Your appointment has been confirmed. Here are the details:' || chr(10) || chr(10) || 'Appointment Title: {{appointment.title}}' || chr(10) || 'Date and Time: {{appointment.start_time}} ({{appointment.timezone}})' || chr(10) || 'Meeting Link / Location: {{appointment.meeting_location}}' || chr(10) || chr(10) || 'We look forward to connecting with you!' || chr(10) || chr(10) || '{{venue.name}}'
        ),
        ('booked_confirmed','sms_owner', false, false, false, null,
         'New booking: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}} ({{appointment.timezone}}).'
        ),
        ('booked_confirmed','sms_contact', true, true, false, null,
         'Hi {{contact.name}}, your appointment "{{appointment.title}}" is confirmed for {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}'
        ),
        ('cancellation','email_owner', true, false, false,
         'Cancelled: {{appointment.title}} with {{contact.name}}',
         'Hi,' || chr(10) || chr(10) || 'The following appointment has been cancelled:' || chr(10) || chr(10) || 'Contact: {{contact.name}} ({{contact.email}})' || chr(10) || 'Title: {{appointment.title}}' || chr(10) || 'Date: {{appointment.start_time}} ({{appointment.timezone}})' || chr(10) || chr(10) || '— {{venue.name}}'
        ),
        ('cancellation','email_contact', true, true, false,
         'Your Appointment Has Been Cancelled',
         'Hi {{contact.name}},' || chr(10) || chr(10) || 'Your appointment "{{appointment.title}}" scheduled for {{appointment.start_time}} ({{appointment.timezone}}) has been cancelled.' || chr(10) || chr(10) || 'If you would like to reschedule, please reach out to us.' || chr(10) || chr(10) || '{{venue.name}}'
        ),
        ('cancellation','sms_owner', false, false, false, null,
         'Cancelled: {{appointment.title}} with {{contact.name}} (was {{appointment.start_time}}).'
        ),
        ('cancellation','sms_contact', true, true, false, null,
         'Hi {{contact.name}}, your appointment "{{appointment.title}}" on {{appointment.start_time}} has been cancelled. Contact us to reschedule.'
        ),
        ('reschedule','email_owner', true, false, false,
         'Rescheduled: {{appointment.title}} with {{contact.name}}',
         'Hi,' || chr(10) || chr(10) || 'An appointment has been rescheduled:' || chr(10) || chr(10) || 'Contact: {{contact.name}} ({{contact.email}})' || chr(10) || 'Title: {{appointment.title}}' || chr(10) || 'New Date & Time: {{appointment.start_time}} ({{appointment.timezone}})' || chr(10) || 'Location: {{appointment.meeting_location}}' || chr(10) || chr(10) || '— {{venue.name}}'
        ),
        ('reschedule','email_contact', true, true, false,
         'Your Appointment Has Been Rescheduled',
         'Hi {{contact.name}},' || chr(10) || chr(10) || 'Your appointment "{{appointment.title}}" has been rescheduled to:' || chr(10) || chr(10) || 'Date & Time: {{appointment.start_time}} ({{appointment.timezone}})' || chr(10) || 'Location: {{appointment.meeting_location}}' || chr(10) || chr(10) || '{{venue.name}}'
        ),
        ('reschedule','sms_owner', false, false, false, null,
         'Rescheduled: {{appointment.title}} with {{contact.name}} → {{appointment.start_time}} ({{appointment.timezone}}).'
        ),
        ('reschedule','sms_contact', true, true, false, null,
         'Hi {{contact.name}}, your appointment "{{appointment.title}}" has been rescheduled to {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}'
        ),
        ('reminder','email_owner', true, false, false,
         'Upcoming Appointment: {{appointment.title}} with {{contact.name}}',
         'Hi,' || chr(10) || chr(10) || 'Reminder: you have an upcoming appointment.' || chr(10) || chr(10) || 'Contact: {{contact.name}} ({{contact.email}})' || chr(10) || 'Title: {{appointment.title}}' || chr(10) || 'Date & Time: {{appointment.start_time}} ({{appointment.timezone}})' || chr(10) || 'Location: {{appointment.meeting_location}}' || chr(10) || chr(10) || '— {{venue.name}}'
        ),
        ('reminder','email_contact', true, true, false,
         'Reminder: Your Appointment — {{appointment.title}}',
         'Hi {{contact.name}},' || chr(10) || chr(10) || 'This is a reminder for your upcoming appointment:' || chr(10) || chr(10) || 'Appointment Title: {{appointment.title}}' || chr(10) || 'Date and Time: {{appointment.start_time}} ({{appointment.timezone}})' || chr(10) || 'Meeting Link / Location: {{appointment.meeting_location}}' || chr(10) || chr(10) || 'We look forward to speaking with you!' || chr(10) || chr(10) || '{{venue.name}}'
        ),
        ('reminder','sms_owner', false, false, false, null,
         'Reminder: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}} ({{appointment.timezone}}).'
        ),
        ('reminder','sms_contact', true, true, false, null,
         'Hi {{contact.name}}, reminder: "{{appointment.title}}" is on {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}'
        ),
        ('follow_up','email_owner', true, false, false,
         'Follow-Up: {{appointment.title}} with {{contact.name}} completed',
         'Hi,' || chr(10) || chr(10) || 'The following appointment has been completed:' || chr(10) || chr(10) || 'Contact: {{contact.name}} ({{contact.email}})' || chr(10) || 'Title: {{appointment.title}}' || chr(10) || 'Date: {{appointment.start_time}} ({{appointment.timezone}})' || chr(10) || chr(10) || '— {{venue.name}}'
        ),
        ('follow_up','email_contact', true, true, false,
         'Thank You — {{appointment.title}}',
         'Hi {{contact.name}},' || chr(10) || chr(10) || 'Thank you for your appointment "{{appointment.title}}" on {{appointment.start_time}}.' || chr(10) || chr(10) || 'We hope it was valuable! Please don''t hesitate to reach out if you have any questions.' || chr(10) || chr(10) || '{{venue.name}}'
        ),
        ('follow_up','sms_owner', false, false, false, null,
         'Completed: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}}.'
        ),
        ('follow_up','sms_contact', true, true, false, null,
         'Hi {{contact.name}}, thanks for your appointment "{{appointment.title}}"! Feel free to reach out with any questions. — {{venue.name}}'
        )
      ) AS n(notification_type, channel, enabled, notify_contact, notify_assigned, subject, body)
      ON CONFLICT (venue_id, notification_type, channel) DO NOTHING
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({ ok: true, message: 'Migration 078 applied successfully.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[run-migration-078]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
