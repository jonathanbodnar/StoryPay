import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { refreshAppointmentRemindersForVenue } from '@/lib/appointment-reminders';

/**
 * GET /api/calendar/notifications?calendar_id=<id>
 * Returns notification templates for the given calendar_id (null = venue-wide defaults).
 */
export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const calendarId = searchParams.get('calendar_id') ?? null;

  let query = supabaseAdmin
    .from('venue_calendar_notifications')
    .select('*')
    .eq('venue_id', venueId)
    .order('notification_type')
    .order('channel');

  if (calendarId) {
    query = query.eq('calendar_id', calendarId);
  } else {
    query = query.is('calendar_id', null);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/**
 * PUT /api/calendar/notifications
 * Upsert notification templates. Accepts an optional `calendar_id` field on
 * each row so per-calendar templates can be saved alongside the defaults.
 */
export async function PUT(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows: Array<{
    notification_type: string;
    channel: string;
    enabled: boolean;
    notify_contact: boolean;
    notify_assigned: boolean;
    notify_guests: boolean;
    additional_emails?: string[];
    additional_phones?: string[];
    subject?: string;
    body?: string;
    offset_minutes?: number;
    reminder_offsets?: { d: number; h: number; m: number }[] | null;
    calendar_id?: string | null;
  }> = await req.json();

  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: 'Expected array' }, { status: 400 });
  }

  // Group rows by calendar_id so we can upsert each group with the correct
  // conflict key (which depends on whether calendar_id is set or not).
  const withCal = rows.filter((r) => r.calendar_id);
  const withoutCal = rows.filter((r) => !r.calendar_id);

  const toUpsert = (subset: typeof rows) =>
    subset.map((r) => ({
      venue_id: venueId,
      notification_type: r.notification_type,
      channel: r.channel,
      enabled: r.enabled,
      notify_contact: r.notify_contact,
      notify_assigned: r.notify_assigned,
      notify_guests: r.notify_guests ?? false,
      additional_emails: r.additional_emails ?? [],
      additional_phones: r.additional_phones ?? [],
      subject: r.subject ?? null,
      body: r.body ?? null,
      offset_minutes: r.offset_minutes ?? null,
      reminder_offsets: r.reminder_offsets ?? null,
      calendar_id: r.calendar_id ?? null,
      updated_at: new Date().toISOString(),
    }));

  let allData: unknown[] = [];

  if (withoutCal.length) {
    const { data, error } = await supabaseAdmin
      .from('venue_calendar_notifications')
      .upsert(toUpsert(withoutCal), { onConflict: 'venue_id,notification_type,channel' })
      .select()
      .order('notification_type')
      .order('channel');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    allData = [...allData, ...(data ?? [])];
  }

  if (withCal.length) {
    const { data, error } = await supabaseAdmin
      .from('venue_calendar_notifications')
      .upsert(toUpsert(withCal), { onConflict: 'venue_id,notification_type,channel,calendar_id' })
      .select()
      .order('notification_type')
      .order('channel');
    if (error) {
      // Conflict key mismatch (migration not yet applied) — fall back to channel-only conflict
      const { data: fb, error: fbErr } = await supabaseAdmin
        .from('venue_calendar_notifications')
        .upsert(toUpsert(withCal), { onConflict: 'venue_id,notification_type,channel' })
        .select();
      if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 });
      allData = [...allData, ...(fb ?? [])];
    } else {
      allData = [...allData, ...(data ?? [])];
    }
  }

  // Re-sync reminder rows for already-scheduled future events
  refreshAppointmentRemindersForVenue(venueId).catch((e) => {
    console.error('[notifications PUT] refreshAppointmentRemindersForVenue failed:', e);
  });

  return NextResponse.json(allData);
}
