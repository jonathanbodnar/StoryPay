import { formatInTimeZone } from 'date-fns-tz';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { resolveVenueTimezone } from '@/lib/venue-timezone';

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

  await supabaseAdmin.from('calendar_event_reminders').delete().eq('calendar_event_id', calendarEventId);

  const recurrence = (ev as { recurrence_rule?: unknown }).recurrence_rule;
  if (recurrence != null) return;

  if ((ev as { status?: string }).status === 'cancelled') return;

  const customerEmail = ((ev as { customer_email?: string | null }).customer_email || '').trim();
  if (!customerEmail) return;

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('appointment_reminders_enabled, appointment_reminder_offsets, name, timezone')
    .eq('id', (ev as { venue_id: string }).venue_id)
    .maybeSingle();
  if (!venue) return;

  if ((venue as { appointment_reminders_enabled?: boolean }).appointment_reminders_enabled === false) {
    return;
  }

  const offsets = normalizeReminderOffsets(
    (venue as { appointment_reminder_offsets?: unknown }).appointment_reminder_offsets,
  );
  const startAt = new Date(String((ev as { start_at: string }).start_at));
  if (Number.isNaN(startAt.getTime())) return;

  const now = Date.now();
  const rows: Array<{
    calendar_event_id: string;
    venue_id: string;
    reminder_index: number;
    offset_days: number;
    offset_hours: number;
    offset_minutes: number;
    send_at: string;
  }> = [];

  offsets.forEach((o, idx) => {
    const sendAt = computeReminderSendAt(startAt, o);
    if (sendAt.getTime() <= now) return;
    if (sendAt.getTime() >= startAt.getTime()) return;
    rows.push({
      calendar_event_id: calendarEventId,
      venue_id: (ev as { venue_id: string }).venue_id,
      reminder_index: idx,
      offset_days: o.d,
      offset_hours: o.h,
      offset_minutes: o.m,
      send_at: sendAt.toISOString(),
    });
  });

  if (!rows.length) return;

  const { error: insErr } = await supabaseAdmin.from('calendar_event_reminders').insert(rows);
  if (insErr) console.error('[appointment-reminders] insert', insErr);
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

function formatOffsetLabel(o: ReminderOffset): string {
  const parts: string[] = [];
  if (o.d > 0) parts.push(`${o.d} day${o.d === 1 ? '' : 's'}`);
  if (o.h > 0) parts.push(`${o.h} hour${o.h === 1 ? '' : 's'}`);
  if (o.m > 0) parts.push(`${o.m} minute${o.m === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : '0';
}

export async function sendAppointmentReminderEmail(row: {
  id: string;
  send_at: string;
  offset_days: number;
  offset_hours: number;
  offset_minutes: number;
  calendar_event_id: string;
  venue_id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { data: ev } = await supabaseAdmin
    .from('calendar_events')
    .select('title, start_at, end_at, customer_email, status')
    .eq('id', row.calendar_event_id)
    .maybeSingle();
  if (!ev || (ev as { status?: string }).status === 'cancelled') {
    return { ok: false, error: 'event_gone' };
  }
  const to = String((ev as { customer_email?: string | null }).customer_email || '').trim();
  if (!to) return { ok: false, error: 'no_email' };

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, timezone, brand_email, email')
    .eq('id', row.venue_id)
    .maybeSingle();
  const tz = resolveVenueTimezone((venue as { timezone?: string | null } | null)?.timezone);
  const venueName = (venue as { name?: string } | null)?.name || 'Your venue';
  const startAt = new Date(String((ev as { start_at: string }).start_at));
  const when = formatInTimeZone(startAt, tz, "EEEE, MMMM d, yyyy 'at' h:mm a zzz");
  const o: ReminderOffset = {
    d: row.offset_days,
    h: row.offset_hours,
    m: row.offset_minutes,
  };
  const title = String((ev as { title: string }).title || 'Appointment');
  const subject = `Reminder: ${title} — ${venueName}`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1b1b1b;line-height:1.5;">
      <p style="margin:0 0 12px;">This is a reminder about your upcoming appointment.</p>
      <p style="margin:0 0 8px;"><strong>${escapeHtml(title)}</strong></p>
      <p style="margin:0 0 16px;color:#52525b;">${escapeHtml(when)}</p>
      <p style="margin:0;font-size:13px;color:#71717a;">Sent ${escapeHtml(formatOffsetLabel(o))} before the start time.</p>
    </div>
  `;
  const replyTo =
    (venue as { brand_email?: string | null; email?: string | null })?.brand_email ||
    (venue as { email?: string | null })?.email ||
    undefined;
  const r = await sendEmail({
    to,
    subject,
    html,
    replyTo,
    from: { name: venueName },
  });
  return r.success ? { ok: true } : { ok: false, error: r.error };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BATCH = 40;

export async function processAppointmentRemindersCron(): Promise<{
  processed: number;
  sent: number;
  errors: number;
}> {
  const now = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from('calendar_event_reminders')
    .select(
      'id, send_at, offset_days, offset_hours, offset_minutes, calendar_event_id, venue_id',
    )
    .is('sent_at', null)
    .lte('send_at', now)
    .order('send_at', { ascending: true })
    .limit(BATCH);
  if (error) {
    console.error('[cron appointment-reminders] query', error);
    return { processed: 0, sent: 0, errors: 1 };
  }
  let sent = 0;
  let errors = 0;
  for (const raw of due ?? []) {
    const row = raw as {
      id: string;
      send_at: string;
      offset_days: number;
      offset_hours: number;
      offset_minutes: number;
      calendar_event_id: string;
      venue_id: string;
    };
    const result = await sendAppointmentReminderEmail(row);
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
        await supabaseAdmin.from('calendar_event_reminders').delete().eq('id', row.id);
      } else {
        errors++;
      }
    }
  }
  return { processed: (due ?? []).length, sent, errors };
}
