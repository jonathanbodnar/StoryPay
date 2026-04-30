/**
 * Calendar notification dispatch.
 *
 * Loads venue templates from `venue_calendar_notifications`, replaces merge
 * tags, then sends via Resend (email) or GHL (SMS).
 *
 * Channel keys (per migration 078):
 *   email_owner   → email to the venue owner
 *   email_contact → email to the contact / lead
 *   sms_owner     → SMS to the venue owner (requires GHL — currently logs only)
 *   sms_contact   → SMS to the contact (requires GHL)
 *
 * Fallback behaviour:
 *   If no rows exist in venue_calendar_notifications for a given type (i.e. the
 *   venue has never saved templates), built-in defaults are used so
 *   notifications work out of the box.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotifType =
  | 'booked_confirmed'
  | 'cancellation'
  | 'reschedule'
  | 'reminder'
  | 'follow_up';

export interface CalendarNotifVars {
  /** Contact's display name */
  contact_name: string;
  /** Contact's email address */
  contact_email?: string | null;
  /** Contact's phone (E.164 preferred) */
  contact_phone?: string | null;
  /** GHL contact ID (used for SMS routing) */
  contact_ghl_id?: string | null;
  /** Appointment / calendar event title */
  appointment_title: string;
  /** Human-readable start date + time, e.g. "Monday, May 5 at 10:00 AM" */
  appointment_start_time: string;
  /** Timezone label, e.g. "EST" or "America/New_York" */
  appointment_timezone?: string | null;
  /** Meeting link or physical address */
  appointment_meeting_location?: string | null;
}

interface TemplateRow {
  channel: string;
  enabled: boolean;
  subject?: string | null;
  body?: string | null;
}

interface VenueRow {
  email?: string | null;
  name?: string | null;
  ghl_access_token?: string | null;
  ghl_location_id?: string | null;
  ghl_connected?: boolean | null;
}

// ── Built-in default templates ────────────────────────────────────────────────
// Used when a venue has no saved templates for a given notification type.

const BACKEND_DEFAULTS: Record<string, Record<string, { subject?: string; body: string; enabled: boolean }>> = {
  booked_confirmed: {
    email_owner: {
      enabled: true,
      subject: 'New Booking: {{appointment.title}} with {{contact.name}}',
      body: `Hi,

A new appointment has been confirmed.

Contact: {{contact.name}} ({{contact.email}})
Phone: {{contact.phone}}
Title: {{appointment.title}}
Date & Time: {{appointment.start_time}} ({{appointment.timezone}})
Location: {{appointment.meeting_location}}

— {{venue.name}}`,
    },
    email_contact: {
      enabled: true,
      subject: 'Confirmed! Your {{appointment.title}} on {{appointment.start_time}} ({{appointment.timezone}})',
      body: `Hi {{contact.name}},

Your appointment has been confirmed. Here are the details:

Appointment Title: {{appointment.title}}
Date and Time: {{appointment.start_time}} ({{appointment.timezone}})
Meeting Link / Location: {{appointment.meeting_location}}

We look forward to connecting with you!

{{venue.name}}`,
    },
    sms_owner:   { enabled: false, body: 'New booking: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}} ({{appointment.timezone}}).' },
    sms_contact: { enabled: true,  body: 'Hi {{contact.name}}, your appointment "{{appointment.title}}" is confirmed for {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}' },
  },
  cancellation: {
    email_owner: {
      enabled: true,
      subject: 'Cancelled: {{appointment.title}} with {{contact.name}}',
      body: `Hi,

The following appointment has been cancelled:

Contact: {{contact.name}} ({{contact.email}})
Title: {{appointment.title}}
Date: {{appointment.start_time}} ({{appointment.timezone}})

— {{venue.name}}`,
    },
    email_contact: {
      enabled: true,
      subject: 'Your Appointment Has Been Cancelled',
      body: `Hi {{contact.name}},

Your appointment "{{appointment.title}}" scheduled for {{appointment.start_time}} ({{appointment.timezone}}) has been cancelled.

If you would like to reschedule, please reach out to us.

{{venue.name}}`,
    },
    sms_owner:   { enabled: false, body: 'Cancelled: {{appointment.title}} with {{contact.name}} (was {{appointment.start_time}}).' },
    sms_contact: { enabled: true,  body: 'Hi {{contact.name}}, your appointment "{{appointment.title}}" on {{appointment.start_time}} has been cancelled. Contact us to reschedule.' },
  },
  reschedule: {
    email_owner: {
      enabled: true,
      subject: 'Rescheduled: {{appointment.title}} with {{contact.name}}',
      body: `Hi,

An appointment has been rescheduled:

Contact: {{contact.name}} ({{contact.email}})
Title: {{appointment.title}}
New Date & Time: {{appointment.start_time}} ({{appointment.timezone}})
Location: {{appointment.meeting_location}}

— {{venue.name}}`,
    },
    email_contact: {
      enabled: true,
      subject: 'Your Appointment Has Been Rescheduled',
      body: `Hi {{contact.name}},

Your appointment "{{appointment.title}}" has been rescheduled to:

Date & Time: {{appointment.start_time}} ({{appointment.timezone}})
Location: {{appointment.meeting_location}}

{{venue.name}}`,
    },
    sms_owner:   { enabled: false, body: 'Rescheduled: {{appointment.title}} with {{contact.name}} → {{appointment.start_time}} ({{appointment.timezone}}).' },
    sms_contact: { enabled: true,  body: 'Hi {{contact.name}}, your appointment "{{appointment.title}}" has been rescheduled to {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}' },
  },
  reminder: {
    email_owner: {
      enabled: true,
      subject: 'Upcoming Appointment: {{appointment.title}} with {{contact.name}}',
      body: `Hi,

Reminder: you have an upcoming appointment.

Contact: {{contact.name}} ({{contact.email}})
Title: {{appointment.title}}
Date & Time: {{appointment.start_time}} ({{appointment.timezone}})
Location: {{appointment.meeting_location}}

— {{venue.name}}`,
    },
    email_contact: {
      enabled: true,
      subject: 'Reminder: Your Appointment — {{appointment.title}}',
      body: `Hi {{contact.name}},

This is a reminder for your upcoming appointment:

Appointment Title: {{appointment.title}}
Date and Time: {{appointment.start_time}} ({{appointment.timezone}})
Meeting Link / Location: {{appointment.meeting_location}}

We look forward to speaking with you!

{{venue.name}}`,
    },
    sms_owner:   { enabled: false, body: 'Reminder: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}} ({{appointment.timezone}}).' },
    sms_contact: { enabled: true,  body: 'Hi {{contact.name}}, reminder: "{{appointment.title}}" is on {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}' },
  },
  follow_up: {
    email_owner: {
      enabled: true,
      subject: 'Follow-Up: {{appointment.title}} with {{contact.name}} completed',
      body: `Hi,

The following appointment has been completed:

Contact: {{contact.name}} ({{contact.email}})
Title: {{appointment.title}}
Date: {{appointment.start_time}} ({{appointment.timezone}})

— {{venue.name}}`,
    },
    email_contact: {
      enabled: true,
      subject: 'Thank You — {{appointment.title}}',
      body: `Hi {{contact.name}},

Thank you for your appointment "{{appointment.title}}" on {{appointment.start_time}}.

We hope it was valuable! Please don't hesitate to reach out if you have any questions.

{{venue.name}}`,
    },
    sms_owner:   { enabled: false, body: 'Completed: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}}.' },
    sms_contact: { enabled: true,  body: 'Hi {{contact.name}}, thanks for your appointment "{{appointment.title}}"! Feel free to reach out with any questions. — {{venue.name}}' },
  },
};

// ── Merge-tag renderer ────────────────────────────────────────────────────────

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
    const trimmed = key.trim();
    return vars[trimmed] ?? '';
  });
}

function buildVarMap(venue: VenueRow, vars: CalendarNotifVars): Record<string, string> {
  return {
    'contact.name':                     vars.contact_name || 'Guest',
    'contact.email':                    vars.contact_email || '',
    'contact.phone':                    vars.contact_phone || '',
    'appointment.title':                vars.appointment_title || 'Appointment',
    'appointment.start_time':           vars.appointment_start_time || '',
    'appointment.timezone':             vars.appointment_timezone || '',
    'appointment.meeting_location':     vars.appointment_meeting_location || '',
    'venue.name':                       venue.name || 'Us',
  };
}

// ── HTML wrapper for plain-text email bodies ──────────────────────────────────

function plainToHtml(text: string, venueName: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:24px 28px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:18px;margin:0;font-weight:400">${venueName}</h1>
  </div>
  <div style="padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <pre style="font-family:'Open Sans',Arial,sans-serif;font-size:14px;line-height:1.8;color:#374151;margin:0;white-space:pre-wrap">${escaped}</pre>
    <hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0 12px">
    <p style="font-size:11px;color:#9ca3af;margin:0;text-align:center">
      Sent via StoryVenue on behalf of ${venueName}
    </p>
  </div>
</div>`;
}

// ── Resolve template: DB row → fallback default ───────────────────────────────

function resolveTemplate(
  type: string,
  channel: string,
  dbRows: TemplateRow[],
  hasAnyDbRows: boolean,
): { enabled: boolean; subject?: string | null; body?: string | null } | null {
  const dbRow = dbRows.find((r) => r.channel === channel);

  // If this venue has DB rows for this notification type, always respect them
  // (enabled=false means the venue deliberately disabled this channel).
  if (hasAnyDbRows && dbRow !== undefined) {
    return dbRow;
  }

  // If the venue has DB rows but not for this specific channel, it means either
  // this channel was never seeded or intentionally excluded — skip it.
  if (hasAnyDbRows && dbRow === undefined) {
    return null;
  }

  // No DB rows at all for this type → use built-in defaults (out-of-the-box behaviour)
  const def = BACKEND_DEFAULTS[type]?.[channel];
  if (!def) return null;
  return { enabled: def.enabled, subject: def.subject ?? null, body: def.body };
}

// ── SMS helper ────────────────────────────────────────────────────────────────

async function dispatchSms(
  token: string,
  locationId: string,
  ghlContactId: string | null | undefined,
  phone: string | null | undefined,
  message: string,
): Promise<void> {
  if (!token || !locationId) return;

  try {
    // Dynamically import to avoid pulling GHL deps into edge bundles
    const { sendSms, ghlRequest, normalizePhone } = await import('@/lib/ghl') as {
      sendSms: (token: string, locationId: string, contactId: string, message: string) => Promise<unknown>;
      ghlRequest: (path: string, token: string, opts?: Record<string, unknown>) => Promise<{ contact?: { id?: string } }>;
      normalizePhone: (phone: string | null) => string | null;
    };

    let contactId = ghlContactId || null;

    if (!contactId && phone) {
      try {
        const norm = normalizePhone(phone) || phone;
        const search = await ghlRequest(
          `/contacts/search/duplicate?locationId=${locationId}&phone=${encodeURIComponent(norm)}`,
          token,
          { locationId },
        );
        contactId = search?.contact?.id ?? null;
      } catch {
        // If lookup fails, skip SMS silently
      }
    }

    if (!contactId) return;
    await sendSms(token, locationId, contactId, message);
  } catch (e) {
    console.error('[calendar-notifications] SMS dispatch error:', e);
  }
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

/**
 * Look up templates for `type` in the venue's settings and fire all enabled
 * channels. Falls back to built-in defaults for venues with no saved templates.
 *
 * Safe to call fire-and-forget — errors are logged, not thrown.
 */
export async function dispatchCalendarNotification(
  venueId: string,
  type: NotifType,
  vars: CalendarNotifVars,
): Promise<void> {
  try {
    const [{ data: templateRows }, { data: venueRow }] = await Promise.all([
      supabaseAdmin
        .from('venue_calendar_notifications')
        .select('channel,enabled,subject,body')
        .eq('venue_id', venueId)
        .eq('notification_type', type),
      supabaseAdmin
        .from('venues')
        .select('email,name,ghl_access_token,ghl_location_id,ghl_connected')
        .eq('id', venueId)
        .maybeSingle(),
    ]);

    if (!venueRow) return;
    const venue = venueRow as VenueRow;
    const rows = (templateRows ?? []) as TemplateRow[];

    // Only the new per-recipient channel keys should be checked.
    // Old 'email'/'sms' rows (from pre-078 seed) are ignored here.
    const perRecipientRows = rows.filter((r) =>
      ['email_owner', 'email_contact', 'sms_owner', 'sms_contact'].includes(r.channel),
    );
    const hasAnyDbRows = perRecipientRows.length > 0;

    const varMap = buildVarMap(venue, vars);
    const venueName = venue.name || 'Us';

    // ── email_owner ───────────────────────────────────────────────────────────
    const eoTpl = resolveTemplate(type, 'email_owner', perRecipientRows, hasAnyDbRows);
    if (eoTpl?.enabled && eoTpl.body && venue.email) {
      const subject = eoTpl.subject
        ? renderTemplate(eoTpl.subject, varMap)
        : `Notification: ${vars.appointment_title}`;
      const body = renderTemplate(eoTpl.body, varMap);
      await sendEmail({
        to: venue.email,
        subject,
        html: plainToHtml(body, venueName),
        from: { name: venueName },
      }).catch((e) => console.error('[calendar-notifications] email_owner send error:', e));
    }

    // ── email_contact ─────────────────────────────────────────────────────────
    const ecTpl = resolveTemplate(type, 'email_contact', perRecipientRows, hasAnyDbRows);
    if (ecTpl?.enabled && ecTpl.body && vars.contact_email) {
      const subject = ecTpl.subject
        ? renderTemplate(ecTpl.subject, varMap)
        : `Notification: ${vars.appointment_title}`;
      const body = renderTemplate(ecTpl.body, varMap);
      await sendEmail({
        to: vars.contact_email,
        subject,
        html: plainToHtml(body, venueName),
        from: { name: venueName },
      }).catch((e) => console.error('[calendar-notifications] email_contact send error:', e));
    }

    // ── sms_contact ───────────────────────────────────────────────────────────
    const scTpl = resolveTemplate(type, 'sms_contact', perRecipientRows, hasAnyDbRows);
    if (
      scTpl?.enabled &&
      scTpl.body &&
      venue.ghl_connected &&
      venue.ghl_access_token &&
      venue.ghl_location_id
    ) {
      const message = renderTemplate(scTpl.body, varMap);
      await dispatchSms(
        venue.ghl_access_token,
        venue.ghl_location_id,
        vars.contact_ghl_id,
        vars.contact_phone,
        message,
      );
    }

    // ── sms_owner ─────────────────────────────────────────────────────────────
    // Venue owner SMS is intentionally off by default (most prefer email).
    // When a venue enables it, they need their own GHL contact ID stored.
    // Logged here for visibility; will be wired when owner_phone is available.
    const soTpl = resolveTemplate(type, 'sms_owner', perRecipientRows, hasAnyDbRows);
    if (soTpl?.enabled && soTpl.body) {
      const message = renderTemplate(soTpl.body, varMap);
      console.log('[calendar-notifications] sms_owner enabled but owner GHL contact not yet wired. Preview:', message.slice(0, 80));
    }

    console.log(`[calendar-notifications] dispatched ${type} for venue ${venueId}`);
  } catch (e) {
    console.error('[calendar-notifications] dispatchCalendarNotification error:', e);
  }
}

// ── Helpers exported for cron / reminder system ───────────────────────────────

/**
 * Build CalendarNotifVars from a raw calendar_events row + venue timezone.
 * Handles the formatting of start_at into a human-readable string.
 */
export async function buildNotifVarsForEvent(
  ev: {
    id: string;
    venue_id: string;
    title: string;
    start_at: string;
    end_at?: string;
    customer_email?: string | null;
  },
  tz?: string,
): Promise<CalendarNotifVars | null> {
  const customerEmail = ev.customer_email?.trim();
  if (!customerEmail) return null;

  // Look up contact info
  const { data: contact } = await supabaseAdmin
    .from('venue_customers')
    .select('first_name,last_name,phone,ghl_contact_id')
    .eq('venue_id', ev.venue_id)
    .ilike('email', customerEmail)
    .maybeSingle();

  const c = contact as { first_name?: string; last_name?: string; phone?: string; ghl_contact_id?: string } | null;
  const contactName = [c?.first_name, c?.last_name].filter(Boolean).join(' ') || customerEmail;

  const resolvedTz = tz ?? 'America/New_York';
  const startDate = new Date(ev.start_at);

  const startFormatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: resolvedTz,
  }).format(startDate);

  const tzLabel =
    new Intl.DateTimeFormat('en-US', { timeZone: resolvedTz, timeZoneName: 'short' })
      .formatToParts(startDate)
      .find((p) => p.type === 'timeZoneName')?.value ?? resolvedTz;

  return {
    contact_name: contactName,
    contact_email: customerEmail,
    contact_phone: c?.phone ?? null,
    contact_ghl_id: c?.ghl_contact_id ?? null,
    appointment_title: ev.title,
    appointment_start_time: startFormatted,
    appointment_timezone: tzLabel,
    appointment_meeting_location: null,
  };
}
