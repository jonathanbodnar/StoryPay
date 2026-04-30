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
 * Save notification templates for a given calendar scope.
 *
 * Venue-wide rows (calendar_id = null):
 *   Upsert against vcn_default_uidx (venue_id, notification_type, channel)
 *   WHERE calendar_id IS NULL.
 *
 * Per-calendar rows (calendar_id set):
 *   DELETE all existing rows for that calendar, then INSERT fresh.
 *   This completely avoids conflict-key complexity and guarantees the saved
 *   state exactly matches what the UI sent — nothing leaks into other calendars.
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

  const toRecord = (r: (typeof rows)[0], calId: string | null) => ({
    venue_id:           venueId,
    notification_type:  r.notification_type,
    channel:            r.channel,
    enabled:            r.enabled,
    notify_contact:     r.notify_contact,
    notify_assigned:    r.notify_assigned,
    notify_guests:      r.notify_guests ?? false,
    additional_emails:  r.additional_emails ?? [],
    additional_phones:  r.additional_phones ?? [],
    subject:            r.subject ?? null,
    body:               r.body ?? null,
    offset_minutes:     r.offset_minutes ?? null,
    reminder_offsets:   r.reminder_offsets ?? null,
    calendar_id:        calId,
    updated_at:         new Date().toISOString(),
  });

  const withCal    = rows.filter((r) => r.calendar_id);
  const withoutCal = rows.filter((r) => !r.calendar_id);
  let allData: unknown[] = [];

  // ── Venue-wide defaults (calendar_id IS NULL) ─────────────────────────────
  if (withoutCal.length) {
    const { data, error } = await supabaseAdmin
      .from('venue_calendar_notifications')
      .upsert(withoutCal.map((r) => toRecord(r, null)), {
        onConflict: 'venue_id,notification_type,channel',
      })
      .select()
      .order('notification_type')
      .order('channel');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    allData = [...allData, ...(data ?? [])];
  }

  // ── Per-calendar rows: DELETE then INSERT (guarantees isolation) ──────────
  if (withCal.length) {
    // Group by calendar_id so each calendar is handled atomically
    const byCalendar = new Map<string, typeof withCal>();
    for (const row of withCal) {
      const calId = row.calendar_id!;
      if (!byCalendar.has(calId)) byCalendar.set(calId, []);
      byCalendar.get(calId)!.push(row);
    }

    for (const [calId, calRows] of byCalendar) {
      // Delete all existing rows for this specific calendar (only this calendar)
      const { error: delErr } = await supabaseAdmin
        .from('venue_calendar_notifications')
        .delete()
        .eq('venue_id', venueId)
        .eq('calendar_id', calId);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

      // Insert the full set the UI sent for this calendar
      const { data, error: insErr } = await supabaseAdmin
        .from('venue_calendar_notifications')
        .insert(calRows.map((r) => toRecord(r, calId)))
        .select()
        .order('notification_type')
        .order('channel');
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      allData = [...allData, ...(data ?? [])];
    }
  }

  // Re-sync reminder rows for already-scheduled future events
  refreshAppointmentRemindersForVenue(venueId).catch((e) => {
    console.error('[notifications PUT] refreshAppointmentRemindersForVenue failed:', e);
  });

  return NextResponse.json(allData);
}
