/**
 * Calendar notification dispatch.
 *
 * Loads venue templates from `venue_calendar_notifications`, replaces merge
 * tags, then sends via Resend (email) or GHL (SMS).
 *
 * Channel keys:
 *   email_owner   → email to the venue owner
 *   email_contact → email to the contact / lead
 *   sms_owner     → SMS to the venue owner (requires GHL)
 *   sms_contact   → SMS to the contact (requires GHL)
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

// ── Merge-tag renderer ────────────────────────────────────────────────────────

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
    const trimmed = key.trim();
    return vars[trimmed] ?? `{{${trimmed}}}`;
  });
}

function buildVarMap(venue: VenueRow, vars: CalendarNotifVars): Record<string, string> {
  return {
    'contact.name':                   vars.contact_name || 'Guest',
    'contact.email':                  vars.contact_email || '',
    'contact.phone':                  vars.contact_phone || '',
    'appointment.title':              vars.appointment_title || 'Appointment',
    'appointment.start_time':         vars.appointment_start_time || '',
    'appointment.timezone':           vars.appointment_timezone || '',
    'appointment.meeting_location':   vars.appointment_meeting_location || '',
    'venue.name':                     venue.name || 'Us',
  };
}

// ── Email helper ──────────────────────────────────────────────────────────────

function plainToHtml(text: string): string {
  return `<div style="font-family:'Open Sans',Arial,sans-serif;font-size:15px;line-height:1.75;color:#374151;max-width:600px;margin:0 auto;padding:32px 24px;white-space:pre-wrap">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  }</div>`;
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

  // Dynamically import to avoid pulling GHL deps into all edge bundles
  const { sendSms, ghlRequest, normalizePhone } = await import('@/lib/ghl');

  let contactId = ghlContactId;

  if (!contactId && phone) {
    try {
      const norm = normalizePhone(phone);
      const search = (await ghlRequest(
        `/contacts/search/duplicate?locationId=${locationId}&phone=${encodeURIComponent(norm || phone)}`,
        token,
        { locationId },
      )) as { contact?: { id?: string } };
      contactId = search?.contact?.id ?? null;
    } catch {
      // If lookup fails, skip SMS
    }
  }

  if (!contactId) return;

  try {
    await sendSms(token, locationId, contactId, message);
  } catch (e) {
    console.error('[calendar-notifications] SMS dispatch error:', e);
  }
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

/**
 * Look up templates for `type` in the venue's settings and fire off
 * all enabled channels (email_owner, email_contact, sms_owner, sms_contact).
 *
 * Safe to call fire-and-forget — all errors are logged, not thrown.
 */
export async function dispatchCalendarNotification(
  venueId: string,
  type: NotifType,
  vars: CalendarNotifVars,
): Promise<void> {
  try {
    // Load templates + venue info in parallel
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
    const varMap = buildVarMap(venue, vars);

    const get = (ch: string) => rows.find((r) => r.channel === ch);

    // ── email_owner ───────────────────────────────────────────────────────────
    const eo = get('email_owner');
    if (eo?.enabled && venue.email && eo.body) {
      const subject = eo.subject ? render(eo.subject, varMap) : `Notification: ${vars.appointment_title}`;
      const body = render(eo.body, varMap);
      await sendEmail({ to: venue.email, subject, html: plainToHtml(body) }).catch((e) =>
        console.error('[calendar-notifications] email_owner error:', e),
      );
    }

    // ── email_contact ─────────────────────────────────────────────────────────
    const ec = get('email_contact');
    if (ec?.enabled && vars.contact_email && ec.body) {
      const subject = ec.subject ? render(ec.subject, varMap) : `Notification: ${vars.appointment_title}`;
      const body = render(ec.body, varMap);
      await sendEmail({ to: vars.contact_email, subject, html: plainToHtml(body) }).catch((e) =>
        console.error('[calendar-notifications] email_contact error:', e),
      );
    }

    // ── sms_owner ─────────────────────────────────────────────────────────────
    // Owner SMS is tricky — we need the venue owner's phone / GHL contact.
    // Skip for now: most venue owners prefer email alerts over SMS to themselves.
    // To enable, store `venue.owner_phone` and a GHL contact ID for the owner.
    const so = get('sms_owner');
    if (so?.enabled && so.body) {
      console.log('[calendar-notifications] sms_owner template is enabled but owner SMS dispatch is not yet wired (no owner phone/GHL contact). Body preview:', render(so.body, varMap).slice(0, 80));
    }

    // ── sms_contact ───────────────────────────────────────────────────────────
    const sc = get('sms_contact');
    if (
      sc?.enabled &&
      sc.body &&
      venue.ghl_connected &&
      venue.ghl_access_token &&
      venue.ghl_location_id
    ) {
      const message = render(sc.body, varMap);
      await dispatchSms(
        venue.ghl_access_token,
        venue.ghl_location_id,
        vars.contact_ghl_id,
        vars.contact_phone,
        message,
      );
    }
  } catch (e) {
    console.error('[calendar-notifications] dispatchCalendarNotification error:', e);
  }
}
