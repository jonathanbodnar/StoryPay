import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

/**
 * POST /api/admin/run-migration-076
 *
 * Creates the calendar tables (076_calendar_settings migration) if they
 * don't exist yet, then seeds default availability and notification rows.
 * Only callable by a verified admin session.
 */
export async function GET() {
  return POST();
}

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = getDb();

    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_calendar_settings (
        id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id                   uuid NOT NULL UNIQUE REFERENCES public.venues(id) ON DELETE CASCADE,
        timezone                   text NOT NULL DEFAULT 'America/New_York',
        google_connected           boolean NOT NULL DEFAULT false,
        google_account_email       text,
        google_access_token        text,
        google_refresh_token       text,
        google_token_expiry        timestamptz,
        google_linked_calendar_id  text,
        hide_event_details         boolean NOT NULL DEFAULT false,
        meeting_duration_min       int NOT NULL DEFAULT 60,
        meeting_interval_min       int NOT NULL DEFAULT 60,
        min_scheduling_notice_hrs  int NOT NULL DEFAULT 24,
        date_range_days            int NOT NULL DEFAULT 60,
        pre_buffer_min             int NOT NULL DEFAULT 0,
        post_buffer_min            int NOT NULL DEFAULT 0,
        max_bookings_per_day       int NOT NULL DEFAULT 4,
        max_bookings_per_slot      int NOT NULL DEFAULT 1,
        created_at                 timestamptz NOT NULL DEFAULT now(),
        updated_at                 timestamptz NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_availability (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id     uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
        day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        is_available boolean NOT NULL DEFAULT true,
        start_time   time NOT NULL DEFAULT '09:00:00',
        end_time     time NOT NULL DEFAULT '17:00:00',
        UNIQUE (venue_id, day_of_week)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_date_overrides (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id      uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
        override_date date NOT NULL,
        is_available  boolean NOT NULL DEFAULT false,
        start_time    time,
        end_time      time,
        label         text,
        UNIQUE (venue_id, override_date)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_conflict_calendars (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id           uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
        google_calendar_id text NOT NULL,
        calendar_name      text,
        account_email      text,
        created_at         timestamptz NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_calendar_notifications (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id          uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
        notification_type text NOT NULL,
        channel           text NOT NULL CHECK (channel IN ('email','sms','in_app')),
        enabled           boolean NOT NULL DEFAULT true,
        notify_contact    boolean NOT NULL DEFAULT true,
        notify_assigned   boolean NOT NULL DEFAULT true,
        notify_guests     boolean NOT NULL DEFAULT false,
        additional_emails text[],
        additional_phones text[],
        subject           text,
        body              text,
        offset_minutes    int,
        updated_at        timestamptz NOT NULL DEFAULT now(),
        UNIQUE (venue_id, notification_type, channel)
      )
    `;

    // Indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_venue_availability_venue ON public.venue_availability(venue_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_venue_date_overrides_venue ON public.venue_date_overrides(venue_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_venue_conflict_cals_venue ON public.venue_conflict_calendars(venue_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_venue_cal_notifications_venue ON public.venue_calendar_notifications(venue_id)`;

    // Seed default availability for all venues
    await sql`
      INSERT INTO public.venue_availability (venue_id, day_of_week, is_available, start_time, end_time)
      SELECT v.id, s.dow, (s.dow BETWEEN 1 AND 5), '09:00:00'::time, '17:00:00'::time
      FROM public.venues v
      CROSS JOIN (SELECT generate_series(0,6) AS dow) s
      ON CONFLICT (venue_id, day_of_week) DO NOTHING
    `;

    // Seed default notification rows
    await sql`
      INSERT INTO public.venue_calendar_notifications
        (venue_id, notification_type, channel, enabled, notify_contact, notify_assigned, subject, body)
      SELECT v.id, n.notification_type, n.channel, true, true, true, n.subject, n.body
      FROM public.venues v
      CROSS JOIN (VALUES
        ('booked_unconfirmed','email','Appointment Request: {{appointment.title}}','Hi {{contact.name}}, we received your appointment request for {{appointment.start_time}} and will confirm shortly.'),
        ('booked_confirmed','email','Confirmed: {{appointment.title}}','Hi {{contact.name}}, your appointment is confirmed for {{appointment.start_time}} {{appointment.timezone}}.'),
        ('booked_confirmed','sms','','Your appointment with {{venue.name}} is confirmed for {{appointment.start_time}}.'),
        ('cancellation','email','Appointment Cancelled: {{appointment.title}}','Hi {{contact.name}}, your appointment on {{appointment.start_time}} has been cancelled.'),
        ('cancellation','sms','','Your appointment with {{venue.name}} on {{appointment.start_time}} has been cancelled.'),
        ('reschedule','email','Rescheduled: {{appointment.title}}','Hi {{contact.name}}, your appointment has been rescheduled to {{appointment.start_time}}.'),
        ('reminder','email','Reminder: {{appointment.title}} Tomorrow','Hi {{contact.name}}, just a reminder about your appointment tomorrow at {{appointment.start_time}}.'),
        ('reminder','sms','','Reminder: You have an appointment with {{venue.name}} at {{appointment.start_time}}.'),
        ('follow_up','email','How did it go? {{appointment.title}}','Hi {{contact.name}}, thank you for visiting! We hope everything went smoothly.')
      ) AS n(notification_type, channel, subject, body)
      ON CONFLICT (venue_id, notification_type, channel) DO NOTHING
    `;

    // Tell PostgREST to reload its schema cache
    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({ ok: true, message: 'Migration 076 applied successfully.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[run-migration-076]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
