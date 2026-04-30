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
import { renderMergeVars, systemDateVars } from '@/lib/merge-variables';

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotifType =
  | 'booked_confirmed'
  | 'cancellation'
  | 'reschedule'
  | 'reminder'
  | 'follow_up';

export interface CalendarNotifVars {
  /** Contact's display name (full) */
  contact_name: string;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  /** Contact's email address */
  contact_email?: string | null;
  /** Contact's phone (E.164 preferred) */
  contact_phone?: string | null;
  /** GHL contact ID (used for SMS routing) */
  contact_ghl_id?: string | null;
  /** DND flags — when true, outbound messages to the contact are blocked */
  contact_sms_dnd?: boolean;
  contact_email_dnd?: boolean;
  /** Appointment / calendar event title */
  appointment_title: string;
  /** Human-readable start date + time, e.g. "Monday, May 5 at 10:00 AM" */
  appointment_start_time: string;
  /** Date only, e.g. "Monday, May 5, 2026" */
  appointment_date?: string | null;
  /** Time only, e.g. "2:00 PM" */
  appointment_time?: string | null;
  /** Human-readable end date + time */
  appointment_end_time?: string | null;
  /** Duration string, e.g. "1 hour" or "30 minutes" */
  appointment_duration?: string | null;
  /** Timezone label, e.g. "EST" or "America/New_York" */
  appointment_timezone?: string | null;
  /** Meeting link or physical address */
  appointment_meeting_location?: string | null;
  /** Name of the calendar this event belongs to */
  appointment_calendar_name?: string | null;
  /** Appointment status */
  appointment_status?: string | null;
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
  owner_first_name?: string | null;
  owner_last_name?: string | null;
  notification_phone?: string | null;
  location_full?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  brand_website?: string | null;
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
  return renderMergeVars(template, vars);
}

function buildVarMap(venue: VenueRow, vars: CalendarNotifVars): Record<string, string> {
  const ownerFirst = venue.owner_first_name || '';
  const ownerLast  = venue.owner_last_name  || '';
  const ownerName  = [ownerFirst, ownerLast].filter(Boolean).join(' ');
  const venueAddr  = venue.location_full
    || [venue.location_city, venue.location_state].filter(Boolean).join(', ')
    || '';
  const sysVars = systemDateVars();
  return {
    // ── Contact (canonical) ──────────────────────────────────────────────
    'contact.first_name':              vars.contact_first_name || vars.contact_name.split(' ')[0] || '',
    'contact.last_name':               vars.contact_last_name  || '',
    'contact.name':                    vars.contact_name || 'Guest',
    'contact.email':                   vars.contact_email || '',
    'contact.phone':                   vars.contact_phone || '',
    // ── Appointment (canonical) ──────────────────────────────────────────
    'appointment.title':               vars.appointment_title || 'Appointment',
    'appointment.date':                vars.appointment_date || '',
    'appointment.time':                vars.appointment_time || '',
    'appointment.start_time':          vars.appointment_start_time || '',
    'appointment.end_time':            vars.appointment_end_time || '',
    'appointment.duration':            vars.appointment_duration || '',
    'appointment.timezone':            vars.appointment_timezone || '',
    'appointment.meeting_location':    vars.appointment_meeting_location || '',
    'appointment.calendar_name':       vars.appointment_calendar_name || '',
    'appointment.status':              vars.appointment_status || '',
    // ── Venue (canonical) ────────────────────────────────────────────────
    'venue.name':                      venue.name || 'Us',
    'venue.owner_name':                ownerName,
    'venue.owner_first_name':          ownerFirst,
    'venue.email':                     venue.email || '',
    'venue.phone':                     venue.notification_phone || '',
    'venue.address':                   venueAddr,
    'venue.city':                      venue.location_city || '',
    'venue.state':                     venue.location_state || '',
    'venue.website':                   venue.brand_website || '',
    // ── System (canonical) ───────────────────────────────────────────────
    ...sysVars,
    // ── Legacy flat aliases (backwards compat) ───────────────────────────
    'contact_name':                    vars.contact_name || 'Guest',
    'contact_email':                   vars.contact_email || '',
    'contact_phone':                   vars.contact_phone || '',
    'first_name':                      vars.contact_first_name || vars.contact_name.split(' ')[0] || '',
    'last_name':                       vars.contact_last_name  || '',
    'venue_name':                      venue.name || 'Us',
  };
}

// ── HTML wrapper for plain-text email bodies ──────────────────────────────────

export function plainToHtml(text: string, venueName: string): string {
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

/**
 * Dispatch an SMS via GHL.
 * Returns `true` if the SMS was handed off to GHL, `false` on any failure.
 * Never throws — errors are logged, callers check the return value.
 */
async function dispatchSms(
  token: string,
  locationId: string,
  ghlContactId: string | null | undefined,
  phone: string | null | undefined,
  email: string | null | undefined,
  message: string,
): Promise<boolean> {
  if (!token || !locationId) {
    console.warn('[calendar-notifications] dispatchSms: missing token or locationId');
    return false;
  }

  try {
    const { sendSms, ghlRequest, normalizePhone } = await import('@/lib/ghl') as {
      sendSms: (token: string, locationId: string, contactId: string, message: string) => Promise<unknown>;
      ghlRequest: (path: string, token: string, opts?: Record<string, unknown>) => Promise<{ contact?: { id?: string }; contacts?: { id?: string }[] }>;
      normalizePhone: (phone: string | null | undefined) => string | null;
    };

    let contactId = ghlContactId || null;

    // 1. Try phone lookup
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
        // phone lookup failed, fall through to email lookup
      }
    }

    // 2. Try email lookup if phone didn't resolve
    if (!contactId && email) {
      try {
        const search = await ghlRequest(
          `/contacts/search/duplicate?locationId=${locationId}&email=${encodeURIComponent(email)}`,
          token,
          { locationId },
        );
        contactId = search?.contact?.id ?? null;

        // Some GHL accounts return contacts[] not contact{}
        if (!contactId && Array.isArray(search?.contacts)) {
          contactId = search.contacts[0]?.id ?? null;
        }
      } catch {
        // email lookup failed too
      }
    }

    if (!contactId) {
      console.warn('[calendar-notifications] dispatchSms: could not resolve GHL contact — phone:', phone, 'email:', email);
      return false;
    }

    await sendSms(token, locationId, contactId, message);
    return true;
  } catch (e) {
    console.error('[calendar-notifications] dispatchSms error:', e);
    return false;
  }
}

/**
 * Resolve a fresh GHL access token for a venue, refreshing via OAuth if needed.
 * Falls back to the stored token if refresh fails so we always have something to try.
 */
async function resolveVenueGhlToken(venueId: string, storedToken: string): Promise<string> {
  try {
    const { supabaseAdmin: sba } = await import('@/lib/supabase');
    const { data: v } = await sba
      .from('venues')
      .select('ghl_refresh_token, ghl_token_expires_at')
      .eq('id', venueId)
      .maybeSingle();

    const expiresAt = (v as { ghl_token_expires_at?: string | null } | null)?.ghl_token_expires_at;
    const refreshToken = (v as { ghl_refresh_token?: string | null } | null)?.ghl_refresh_token;

    const isExpiredOrSoon = !expiresAt || new Date(expiresAt).getTime() < Date.now() + 5 * 60 * 1000;

    if (isExpiredOrSoon && refreshToken) {
      const { refreshAccessToken } = await import('@/lib/ghl') as {
        refreshAccessToken: (rt: string) => Promise<{ access_token: string; expires_in?: number }>;
      };
      const result = await refreshAccessToken(refreshToken);
      const newToken = result.access_token;
      const newExpiry = result.expires_in
        ? new Date(Date.now() + result.expires_in * 1000).toISOString()
        : null;

      // Persist the refreshed token back to the DB
      const updateData: Record<string, string | null> = { ghl_access_token: newToken };
      if (newExpiry) updateData.ghl_token_expires_at = newExpiry;
      await sba.from('venues').update(updateData).eq('id', venueId);

      console.log('[calendar-notifications] refreshed GHL token for venue', venueId);
      return newToken;
    }
  } catch (e) {
    console.warn('[calendar-notifications] token refresh failed, using stored token:', e);
  }
  return storedToken;
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

/**
 * Look up templates for `type` in the venue's settings and fire enabled channels.
 *
 * @param onlyChannel - When provided, only that specific channel is dispatched.
 *   Use this for per-channel reminder rows so each fires independently.
 *   When omitted, all enabled channels are dispatched (e.g. booked_confirmed).
 *
 * Safe to call fire-and-forget — errors are logged, not thrown.
 */
export async function dispatchCalendarNotification(
  venueId: string,
  type: NotifType,
  vars: CalendarNotifVars,
  onlyChannel?: string,
  calendarId?: string | null,
): Promise<void> {
  try {
    // Load templates: prefer calendar-specific rows, fall back to venue-wide defaults.
    // Two-query strategy: first try with calendar_id filter, then fall back if empty.
    let templateRows: TemplateRow[] | null = null;

    if (calendarId) {
      const { data: calRows } = await supabaseAdmin
        .from('venue_calendar_notifications')
        .select('channel,enabled,subject,body')
        .eq('venue_id', venueId)
        .eq('notification_type', type)
        .eq('calendar_id', calendarId);
      if (calRows && calRows.length > 0) {
        templateRows = calRows as TemplateRow[];
      }
    }

    // Fall back to venue-wide defaults when no calendar-specific templates exist
    if (!templateRows) {
      const { data: defaultRows } = await supabaseAdmin
        .from('venue_calendar_notifications')
        .select('channel,enabled,subject,body')
        .eq('venue_id', venueId)
        .eq('notification_type', type)
        .is('calendar_id', null);
      templateRows = (defaultRows ?? []) as TemplateRow[];
    }

    const { data: venueRow } = await supabaseAdmin
      .from('venues')
      .select('email,name,owner_first_name,owner_last_name,notification_phone,location_full,location_city,location_state,brand_website,ghl_access_token,ghl_location_id,ghl_connected')
      .eq('id', venueId)
      .maybeSingle();

    // Resolve a potentially-refreshed GHL token before any SMS dispatch
    let ghlToken = (venueRow as VenueRow | null)?.ghl_access_token ?? null;
    if (ghlToken && (venueRow as VenueRow | null)?.ghl_location_id) {
      ghlToken = await resolveVenueGhlToken(venueId, ghlToken);
    }

    if (!venueRow) return;
    const venue = venueRow as VenueRow;
    const rows = (templateRows ?? []) as TemplateRow[];

    const perRecipientRows = rows.filter((r) =>
      ['email_owner', 'email_contact', 'sms_owner', 'sms_contact'].includes(r.channel),
    );
    const hasAnyDbRows = perRecipientRows.length > 0;

    const varMap = buildVarMap(venue, vars);
    const venueName = venue.name || 'Us';

    // Helper: skip this channel if onlyChannel is specified and doesn't match
    const shouldSend = (channel: string) => !onlyChannel || onlyChannel === channel;

    // Use the refreshed GHL token (resolved above) or fall back to stored
    const effectiveGhlToken = ghlToken ?? venue.ghl_access_token ?? null;

    // Track whether an SMS dispatch was attempted and whether it succeeded.
    // When onlyChannel targets an SMS channel, a failure will be surfaced to
    // the caller (processAppointmentRemindersCron) so the row is not marked
    // sent_at and will be retried on the next cron tick.
    let smsAttempted = false;
    let smsOk = false;

    // ── email_owner ───────────────────────────────────────────────────────────
    if (shouldSend('email_owner')) {
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
    }

    // ── email_contact ─────────────────────────────────────────────────────────
    if (shouldSend('email_contact')) {
      if (vars.contact_email_dnd) {
        console.log(`[calendar-notifications] email_contact BLOCKED — email DND active for ${vars.contact_email}`);
      } else {
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
      }
    }

    // ── sms_contact ───────────────────────────────────────────────────────────
    if (shouldSend('sms_contact')) {
      if (vars.contact_sms_dnd) {
        console.log(`[calendar-notifications] sms_contact BLOCKED — SMS DND active for ${vars.contact_email}`);
        // DND counts as "ok" — the message was intentionally suppressed, not a failure
        smsAttempted = true;
        smsOk = true;
      } else if (
        venue.ghl_connected &&
        effectiveGhlToken &&
        venue.ghl_location_id
      ) {
        const scTpl = resolveTemplate(type, 'sms_contact', perRecipientRows, hasAnyDbRows);
        if (scTpl?.enabled && scTpl.body) {
          const message = renderTemplate(scTpl.body, varMap);
          smsAttempted = true;
          smsOk = await dispatchSms(
            effectiveGhlToken,
            venue.ghl_location_id,
            vars.contact_ghl_id,
            vars.contact_phone,
            vars.contact_email,
            message,
          );
          if (!smsOk) {
            console.error(
              `[calendar-notifications] sms_contact dispatch failed for ${type} — venue ${venueId}, contact ${vars.contact_email}`,
            );
          }
        }
      }
    }

    // ── sms_owner ─────────────────────────────────────────────────────────────
    if (shouldSend('sms_owner')) {
      const soTpl = resolveTemplate(type, 'sms_owner', perRecipientRows, hasAnyDbRows);
      if (
        soTpl?.enabled &&
        soTpl.body &&
        venue.ghl_connected &&
        effectiveGhlToken &&
        venue.ghl_location_id &&
        venue.email
      ) {
        const message = renderTemplate(soTpl.body, varMap);
        smsAttempted = true;
        const ownerOk = await dispatchSms(
          effectiveGhlToken,
          venue.ghl_location_id,
          null,
          null,
          venue.email,
          message,
        );
        // For sms_owner, record success only when it's the targeted channel
        if (onlyChannel === 'sms_owner') smsOk = ownerOk;
      }
    }

    console.log(
      `[calendar-notifications] dispatched ${type}${onlyChannel ? ` [${onlyChannel}]` : ''} for venue ${venueId}`,
    );

    // When the cron targets a specific SMS channel, surface failures so the
    // reminder row is NOT marked sent_at and can be retried next tick.
    const isSmsOnlyChannel = onlyChannel === 'sms_contact' || onlyChannel === 'sms_owner';
    if (isSmsOnlyChannel && smsAttempted && !smsOk) {
      throw new Error(`sms_dispatch_failed:${onlyChannel}`);
    }
  } catch (e) {
    // Re-throw SMS dispatch failures so the cron caller can handle retry.
    // Swallow everything else to keep this fire-and-forget safe.
    if (e instanceof Error && e.message.startsWith('sms_dispatch_failed:')) {
      throw e;
    }
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
    end_at?: string | null;
    customer_email?: string | null;
    calendar_id?: string | null;
    status?: string | null;
  },
  tz?: string,
): Promise<CalendarNotifVars | null> {
  const customerEmail = ev.customer_email?.trim();
  if (!customerEmail) return null;

  // Look up contact info (include DND flags so callers can gate sends)
  const { data: contact } = await supabaseAdmin
    .from('venue_customers')
    .select('first_name,last_name,phone,ghl_contact_id,sms_dnd,conversation_dnd_email,conversation_dnd_all')
    .eq('venue_id', ev.venue_id)
    .ilike('customer_email', customerEmail)
    .maybeSingle();

  const c = contact as {
    first_name?: string; last_name?: string; phone?: string; ghl_contact_id?: string;
    sms_dnd?: boolean; conversation_dnd_email?: boolean; conversation_dnd_all?: boolean;
  } | null;
  const contactFirstName = c?.first_name?.trim() || '';
  const contactLastName  = c?.last_name?.trim()  || '';
  const contactName = [contactFirstName, contactLastName].filter(Boolean).join(' ') || customerEmail;

  const resolvedTz = tz ?? 'America/New_York';
  const startDate = new Date(ev.start_at);

  const startFormatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: resolvedTz,
  }).format(startDate);

  const dateOnly = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: resolvedTz,
  }).format(startDate);

  const timeOnly = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: resolvedTz,
  }).format(startDate);

  const tzLabel =
    new Intl.DateTimeFormat('en-US', { timeZone: resolvedTz, timeZoneName: 'short' })
      .formatToParts(startDate)
      .find((p) => p.type === 'timeZoneName')?.value ?? resolvedTz;

  // End time + duration
  let endTimeFormatted: string | null = null;
  let durationStr: string | null = null;
  if (ev.end_at) {
    const endDate = new Date(ev.end_at);
    endTimeFormatted = new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: resolvedTz,
    }).format(endDate);
    const diffMs = endDate.getTime() - startDate.getTime();
    if (diffMs > 0) {
      const totalMins = Math.round(diffMs / 60000);
      const hrs  = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      if (hrs > 0 && mins > 0)  durationStr = `${hrs} hour${hrs > 1 ? 's' : ''} ${mins} minute${mins > 1 ? 's' : ''}`;
      else if (hrs > 0)         durationStr = `${hrs} hour${hrs > 1 ? 's' : ''}`;
      else                      durationStr = `${totalMins} minute${totalMins > 1 ? 's' : ''}`;
    }
  }

  // Calendar name lookup
  let calendarName: string | null = null;
  if (ev.calendar_id) {
    const { data: cal } = await supabaseAdmin
      .from('venue_calendars')
      .select('name')
      .eq('id', ev.calendar_id)
      .maybeSingle();
    calendarName = (cal as { name?: string } | null)?.name ?? null;
  }

  return {
    contact_name:               contactName,
    contact_first_name:         contactFirstName || null,
    contact_last_name:          contactLastName  || null,
    contact_email:              customerEmail,
    contact_phone:              c?.phone ?? null,
    contact_ghl_id:             c?.ghl_contact_id ?? null,
    contact_sms_dnd:            c?.sms_dnd ?? false,
    contact_email_dnd:          (c?.conversation_dnd_email || c?.conversation_dnd_all) ?? false,
    appointment_title:          ev.title,
    appointment_start_time:     startFormatted,
    appointment_date:           dateOnly,
    appointment_time:           timeOnly,
    appointment_end_time:       endTimeFormatted,
    appointment_duration:       durationStr,
    appointment_timezone:       tzLabel,
    appointment_meeting_location: null,
    appointment_calendar_name:  calendarName,
    appointment_status:         ev.status ?? null,
  };
}
