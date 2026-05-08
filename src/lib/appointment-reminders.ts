import { supabaseAdmin } from '@/lib/supabase';
import { resolveVenueTimezone } from '@/lib/venue-timezone';
import {
  dispatchCalendarNotification,
  buildNotifVarsForEvent,
  type NotifType,
} from '@/lib/calendar-notifications';

export type ReminderOffset = { d: number; h: number; m: number };

export const DEFAULT_APPOINTMENT_REMINDER_OFFSETS: ReminderOffset[] = [
  { d: 1, h: 0, m: 0 },
  { d: 0, h: 1, m: 0 },
  { d: 0, h: 0, m: 10 },
];

const MAX_REMINDERS = 5;

export function normalizeReminderOffsets(raw: unknown): ReminderOffset[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_APPOINTMENT_REMINDER_OFFSETS];
  const out: ReminderOffset[] = [];
  for (const row of raw.slice(0, MAX_REMINDERS)) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const d = Math.max(0, Math.min(365, Math.floor(Number(o.d ?? o.days ?? 0) || 0)));
    const h = Math.max(0, Math.floor(Number(o.h ?? o.hours ?? 0) || 0));
    const m = Math.max(0, Math.min(59, Math.floor(Number(o.m ?? o.minutes ?? 0) || 0)));
    if (d === 0 && h === 0 && m === 0) continue;
    out.push({ d, h, m });
  }
  return out.length ? out : [...DEFAULT_APPOINTMENT_REMINDER_OFFSETS];
}

function offsetToMs(o: ReminderOffset): number {
  const ms = ((o.d * 24 + o.h) * 60 + o.m) * 60 * 1000;
  const max = 366 * 24 * 60 * 60 * 1000;
  return Math.min(ms, max);
}

/** send_at = start_at - offset (wall-clock safe via epoch math). */
export function computeReminderSendAt(startAt: Date, o: ReminderOffset): Date {
  return new Date(startAt.getTime() - offsetToMs(o));
}

/** Default per-channel reminder offsets (mirrors the UI constant) */
const DEFAULT_CHANNEL_OFFSETS: Record<string, ReminderOffset[]> = {
  email_owner:   [{ d: 1, h: 0, m: 0 }, { d: 0, h: 1, m: 0 }, { d: 0, h: 0, m: 10 }],
  email_contact: [{ d: 1, h: 0, m: 0 }, { d: 0, h: 1, m: 0 }, { d: 0, h: 0, m: 10 }],
  sms_owner:     [{ d: 0, h: 1, m: 0 }, { d: 0, h: 0, m: 10 }],
  sms_contact:   [{ d: 0, h: 1, m: 0 }, { d: 0, h: 0, m: 10 }],
};

/** Default follow-up offset: 30 minutes after event ends */
const DEFAULT_FOLLOWUP_OFFSET: ReminderOffset = { d: 0, h: 0, m: 30 };

/** send_at = end_at + offset (for follow-up rows) */
function computeFollowUpSendAt(endAt: Date, o: ReminderOffset): Date {
  return new Date(endAt.getTime() + offsetToMs(o));
}

/**
 * Sync reminder + follow-up queue rows for a single calendar event.
 *
 * Reminder rows (notification_type = 'reminder'):
 *   One row per (enabled channel × offset), tagged with the channel name.
 *   send_at = start_at − offset
 *
 * Follow-up row (notification_type = 'follow_up', reminder_index = 98):
 *   send_at = end_at + 30 minutes  (channel = null — fires all enabled channels at once)
 */
export async function syncAppointmentRemindersForEvent(calendarEventId: string): Promise<void> {
  const { data: ev, error: evErr } = await supabaseAdmin
    .from('calendar_events')
    .select('id, venue_id, start_at, end_at, status, customer_email, title, recurrence_rule, all_day')
    .eq('id', calendarEventId)
    .maybeSingle();

  if (evErr || !ev) {
    console.error('[appointment-reminders] load event', evErr);
    return;
  }

  // Clear existing unsent reminder + follow-up rows for this event
  await supabaseAdmin
    .from('calendar_event_reminders')
    .delete()
    .eq('calendar_event_id', calendarEventId)
    .is('sent_at', null);

  const recurrence = (ev as { recurrence_rule?: unknown }).recurrence_rule;
  if (recurrence != null) return;
  if ((ev as { status?: string }).status === 'cancelled') return;

  const customerEmail = ((ev as { customer_email?: string | null }).customer_email || '').trim();
  if (!customerEmail) return;

  const venueId = (ev as { venue_id: string }).venue_id;

  // Check venue-level reminders kill-switch
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('appointment_reminders_enabled, appointment_reminder_offsets')
    .eq('id', venueId)
    .maybeSingle();
  if (!venue) return;
  if ((venue as { appointment_reminders_enabled?: boolean }).appointment_reminders_enabled === false) return;

  const startAt = new Date(String((ev as { start_at: string }).start_at));
  if (Number.isNaN(startAt.getTime())) return;

  const endAtStr = (ev as { end_at?: string | null }).end_at;
  const endAt = endAtStr ? new Date(endAtStr) : null;
  const now = Date.now();

  type ReminderInsertRow = {
    calendar_event_id: string;
    venue_id: string;
    reminder_index: number;
    offset_days: number;
    offset_hours: number;
    offset_minutes: number;
    send_at: string;
    notification_type: string;
    channel?: string | null;
  };

  const rows: ReminderInsertRow[] = [];

  // ── Per-channel reminder rows ─────────────────────────────────────────────
  // Prefer per-channel notification template rows (migration 079).
  // Fall back to venue-level offsets when no rows are found.
  const { data: notifRows } = await supabaseAdmin
    .from('venue_calendar_notifications')
    .select('channel, enabled, reminder_offsets')
    .eq('venue_id', venueId)
    .eq('notification_type', 'reminder')
    .eq('enabled', true);

  const enabledChannels = (notifRows ?? []) as Array<{
    channel: string;
    enabled: boolean;
    reminder_offsets?: ReminderOffset[] | null;
  }>;

  if (enabledChannels.length > 0) {
    for (const ch of enabledChannels) {
      const rawOffsets =
        ch.reminder_offsets ??
        DEFAULT_CHANNEL_OFFSETS[ch.channel] ??
        DEFAULT_APPOINTMENT_REMINDER_OFFSETS;
      const offsets = normalizeReminderOffsets(rawOffsets);
      offsets.forEach((o, idx) => {
        const sendAt = computeReminderSendAt(startAt, o);
        if (sendAt.getTime() <= now) return;
        if (sendAt.getTime() >= startAt.getTime()) return;
        rows.push({
          calendar_event_id: calendarEventId,
          venue_id: venueId,
          reminder_index: idx,
          offset_days: o.d,
          offset_hours: o.h,
          offset_minutes: o.m,
          send_at: sendAt.toISOString(),
          notification_type: 'reminder',
          channel: ch.channel,
        });
      });
    }
  } else {
    // Legacy fallback: no per-channel notification rows configured — use venue offsets
    const offsets = normalizeReminderOffsets(
      (venue as { appointment_reminder_offsets?: unknown }).appointment_reminder_offsets,
    );
    offsets.forEach((o, idx) => {
      const sendAt = computeReminderSendAt(startAt, o);
      if (sendAt.getTime() <= now) return;
      if (sendAt.getTime() >= startAt.getTime()) return;
      rows.push({
        calendar_event_id: calendarEventId,
        venue_id: venueId,
        reminder_index: idx,
        offset_days: o.d,
        offset_hours: o.h,
        offset_minutes: o.m,
        send_at: sendAt.toISOString(),
        notification_type: 'reminder',
        channel: null, // legacy: fires all enabled channels at once
      });
    });
  }

  // ── Per-channel follow-up rows (configurable timing after event ends) ────────
  // Each enabled follow_up channel fires independently at its own configured time.
  // Falls back to a single 30-min all-channels row when no per-channel rows exist.
  if (endAt && !Number.isNaN(endAt.getTime())) {
    const { data: followUpNotifRows } = await supabaseAdmin
      .from('venue_calendar_notifications')
      .select('channel, enabled, reminder_offsets')
      .eq('venue_id', venueId)
      .eq('notification_type', 'follow_up')
      .eq('enabled', true);

    const enabledFollowUpChannels = (followUpNotifRows ?? []) as Array<{
      channel: string;
      enabled: boolean;
      reminder_offsets?: ReminderOffset[] | null;
    }>;

    if (enabledFollowUpChannels.length > 0) {
      // Per-channel follow-up rows — each channel at its configured timing
      for (const ch of enabledFollowUpChannels) {
        const rawOffsets = ch.reminder_offsets ?? [DEFAULT_FOLLOWUP_OFFSET];
        const offsets = normalizeReminderOffsets(rawOffsets.length ? rawOffsets : [DEFAULT_FOLLOWUP_OFFSET]);
        offsets.forEach((o, idx) => {
          const sendAt = computeFollowUpSendAt(endAt, o);
          if (sendAt.getTime() <= now) return;
          rows.push({
            calendar_event_id: calendarEventId,
            venue_id: venueId,
            reminder_index: idx,
            offset_days: o.d,
            offset_hours: o.h,
            offset_minutes: o.m,
            send_at: sendAt.toISOString(),
            notification_type: 'follow_up',
            channel: ch.channel,
          });
        });
      }
    } else {
      // Legacy / no follow_up rows configured: single 30-min all-channels row
      const followUpSendAt = computeFollowUpSendAt(endAt, DEFAULT_FOLLOWUP_OFFSET);
      if (followUpSendAt.getTime() > now) {
        rows.push({
          calendar_event_id: calendarEventId,
          venue_id: venueId,
          reminder_index: 98,
          offset_days: 0,
          offset_hours: 0,
          offset_minutes: 30,
          send_at: followUpSendAt.toISOString(),
          notification_type: 'follow_up',
          channel: null,
        });
      }
    }
  }

  if (!rows.length) return;

  const { error: insErr } = await supabaseAdmin.from('calendar_event_reminders').insert(rows);
  if (insErr) {
    // Migrations 078/079 may not have run — strip new columns and retry.
    if (
      insErr.message?.toLowerCase().includes('notification_type') ||
      insErr.message?.toLowerCase().includes('channel')
    ) {
      // Legacy: deduplicate by reminder_index (take first) for the old unique index
      const seen = new Set<number>();
      const legacyRows = rows
        .filter((r) => r.notification_type === 'reminder')
        .filter((r) => { if (seen.has(r.reminder_index)) return false; seen.add(r.reminder_index); return true; })
        .map(({ notification_type: _nt, channel: _ch, ...r }) => r);
      if (legacyRows.length) {
        const { error: retryErr } = await supabaseAdmin
          .from('calendar_event_reminders')
          .insert(legacyRows);
        if (retryErr) console.error('[appointment-reminders] insert legacy retry', retryErr);
      }
    } else {
      console.error('[appointment-reminders] insert', insErr);
    }
  }
}

export async function refreshAppointmentRemindersForVenue(venueId: string): Promise<void> {
  const { data: events, error } = await supabaseAdmin
    .from('calendar_events')
    .select('id')
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .is('recurrence_rule', null)
    .gt('start_at', new Date().toISOString());
  if (error) {
    console.error('[appointment-reminders] list future events', error);
    return;
  }
  for (const e of events ?? []) {
    await syncAppointmentRemindersForEvent((e as { id: string }).id);
  }
}

const BATCH = 40;

/**
 * Process due reminder and follow-up rows.
 * Uses dispatchCalendarNotification with the venue's saved templates
 * (falls back to built-in defaults when no templates are saved).
 */
export async function processAppointmentRemindersCron(): Promise<{
  processed: number;
  sent: number;
  errors: number;
}> {
  const now = new Date().toISOString();

  // Attempt to read notification_type and channel (migration 078+079).
  // Fall back to legacy columns if either is missing.
  const { data: due, error } = await supabaseAdmin
    .from('calendar_event_reminders')
    .select('id, send_at, offset_days, offset_hours, offset_minutes, calendar_event_id, venue_id, notification_type, channel')
    .is('sent_at', null)
    .lte('send_at', now)
    .order('send_at', { ascending: true })
    .limit(BATCH);

  let dueRows = due;
  if (
    error?.message?.toLowerCase().includes('notification_type') ||
    error?.message?.toLowerCase().includes('channel')
  ) {
    console.warn('[cron appointment-reminders] notification_type/channel column missing, running legacy query');
    const legacy = await supabaseAdmin
      .from('calendar_event_reminders')
      .select('id, send_at, offset_days, offset_hours, offset_minutes, calendar_event_id, venue_id')
      .is('sent_at', null)
      .lte('send_at', now)
      .order('send_at', { ascending: true })
      .limit(BATCH);
    if (legacy.error) {
      console.error('[cron appointment-reminders] legacy query', legacy.error);
      return { processed: 0, sent: 0, errors: 1 };
    }
    dueRows = legacy.data as typeof dueRows;
  } else if (error) {
    console.error('[cron appointment-reminders] query', error);
    return { processed: 0, sent: 0, errors: 1 };
  }

  let sent = 0;
  let errors = 0;

  for (const raw of dueRows ?? []) {
    const row = raw as {
      id: string;
      send_at: string;
      offset_days: number;
      offset_hours: number;
      offset_minutes: number;
      calendar_event_id: string;
      venue_id: string;
      notification_type?: string | null;
      channel?: string | null;
    };

    const notifType = (row.notification_type as NotifType | undefined | null) ?? 'reminder';
    // When channel is set, dispatch only that channel; otherwise fire all (legacy / follow_up)
    const onlyChannel = row.channel ?? undefined;

    const result = await sendNotificationForReminder(
      row.calendar_event_id,
      row.venue_id,
      notifType,
      onlyChannel,
    );

    if (result.ok) {
      const { error: upErr } = await supabaseAdmin
        .from('calendar_event_reminders')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('sent_at', null);
      if (!upErr) sent++;
      else errors++;
    } else {
      if (result.error === 'event_gone' || result.error === 'no_email') {
        // Event gone or no contact email — no point retrying, delete.
        await supabaseAdmin.from('calendar_event_reminders').delete().eq('id', row.id);
      } else if (result.error === 'sms_dispatch_failed') {
        // SMS delivery failed (GHL error, bad token, etc.).
        // If the reminder's send_at is older than 3 hours, it's too stale to
        // retry — delete it to prevent an infinite retry loop.
        const sendAtMs = new Date(row.send_at).getTime();
        const THREE_HOURS = 3 * 60 * 60 * 1000;
        if (Date.now() - sendAtMs > THREE_HOURS) {
          console.warn('[cron appointment-reminders] stale SMS reminder, removing:', row.id);
          await supabaseAdmin.from('calendar_event_reminders').delete().eq('id', row.id);
        } else {
          // Leave the row unsent — cron will retry on the next tick.
          console.warn('[cron appointment-reminders] SMS dispatch failed, will retry:', row.id);
          errors++;
        }
      } else {
        errors++;
      }
    }
  }

  return { processed: (dueRows ?? []).length, sent, errors };
}

async function sendNotificationForReminder(
  calendarEventId: string,
  venueId: string,
  notifType: NotifType,
  onlyChannel?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: ev } = await supabaseAdmin
    .from('calendar_events')
    .select('id, venue_id, title, start_at, end_at, customer_email, status, calendar_id')
    .eq('id', calendarEventId)
    .maybeSingle();

  if (!ev || (ev as { status?: string }).status === 'cancelled') {
    return { ok: false, error: 'event_gone' };
  }

  const customerEmail = ((ev as { customer_email?: string | null }).customer_email || '').trim();
  if (!customerEmail) return { ok: false, error: 'no_email' };

  // Resolve venue timezone for formatted timestamps
  const { data: calSettings } = await supabaseAdmin
    .from('venue_calendar_settings')
    .select('timezone')
    .eq('venue_id', venueId)
    .maybeSingle();

  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select('timezone')
    .eq('id', venueId)
    .maybeSingle();

  const tz = resolveVenueTimezone(
    (calSettings as { timezone?: string } | null)?.timezone ??
    (venueRow as { timezone?: string } | null)?.timezone,
  );

  const eventForVars = {
    id: (ev as { id: string }).id,
    venue_id: venueId,
    title: String((ev as { title: string }).title || 'Appointment'),
    start_at: String((ev as { start_at: string }).start_at),
    end_at: (ev as { end_at?: string }).end_at,
    customer_email: customerEmail,
    appointment_type: (ev as { appointment_type?: string | null }).appointment_type ?? null,
    notes: (ev as { notes?: string | null }).notes ?? null,
    space_id: (ev as { space_id?: string | null }).space_id ?? null,
  };

  const notifVars = await buildNotifVarsForEvent(eventForVars, tz);
  if (!notifVars) return { ok: false, error: 'no_email' };

  const calendarId = (ev as { calendar_id?: string | null }).calendar_id ?? null;

  try {
    await dispatchCalendarNotification(venueId, notifType, notifVars, onlyChannel, calendarId);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('sms_dispatch_failed:')) {
      // SMS-specific failure — surface it so the cron can retry the row.
      console.warn('[appointment-reminders] SMS dispatch failed for reminder:', calendarEventId, msg);
      return { ok: false, error: 'sms_dispatch_failed' };
    }
    console.error('[appointment-reminders] sendNotificationForReminder error:', e);
    return { ok: false, error: 'dispatch_failed' };
  }
}
