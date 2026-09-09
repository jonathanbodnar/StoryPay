/**
 * Event Temple integration helpers.
 *
 * Event Temple exposes a private-integration REST API (JSON:API spec) that a
 * venue user authenticates against with two values they copy from their own
 * account:
 *   - X-API-KEY  — a user-specific API key (Settings → Developers → API)
 *   - X-API-ORG  — the organization identifier the request is scoped to
 *                  (Settings → Overview → API-ORG)
 *
 * A "lead" in StoryVenue maps to an Event Temple booking created with
 * `status: "lead"` and an embedded new contact. We stamp source attribution and
 * any supplemental form fields onto a Note attached to the booking, since the
 * booking object itself has no free-text field.
 *
 * Docs: https://developers.eventtemple.com/reference/welcome
 */

import { supabaseAdmin } from '@/lib/supabase';

const EVENTTEMPLE_API = 'https://api.eventtemple.com/v2';
const JSON_API = 'application/vnd.api+json';

const SOURCE_LABEL = 'StoryVenue - Bride Booking System™';

function etHeaders(apiKey: string, orgId: string): Record<string, string> {
  return {
    'X-API-KEY': apiKey,
    'X-API-ORG': orgId,
    'Content-Type': JSON_API,
    Accept: JSON_API,
  };
}

export interface EventTempleOrganization {
  id: string;
  name: string;
}

/**
 * Fetch the organizations reachable with the given key + org id. Used both to
 * validate the credentials when connecting and to show the venue which
 * organization their leads will land in.
 */
export async function fetchEventTempleOrganizations(
  apiKey: string,
  orgId: string,
): Promise<EventTempleOrganization[]> {
  const res = await fetch(`${EVENTTEMPLE_API}/organizations`, {
    method: 'GET',
    headers: etHeaders(apiKey, orgId),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Event Temple organizations fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = await res.json().catch(() => ({})) as {
    data?: Array<{ id?: string | number; attributes?: { name?: string } }>;
  };
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.map((row) => ({
    id: String(row.id ?? ''),
    name: String(row.attributes?.name ?? ''),
  })).filter((o) => o.id);
}

export interface EventTempleLead {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  wedding_date?: string;      // ISO date YYYY-MM-DD
  guest_count?: number | null;
  message?: string | null;
  booking_timeline?: string | null;
  venue_matters?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
}

/**
 * Build the note body attached to every Event Temple booking. Includes the
 * source attribution plus any supplemental fields that have no dedicated
 * booking property, formatted so venue staff can read it at a glance.
 */
export function buildEventTempleNote(lead: EventTempleLead): string {
  const lines: string[] = [`Source: ${SOURCE_LABEL}`];

  if (lead.booking_timeline) lines.push(`Booking Timeline: ${lead.booking_timeline}`);
  if (lead.venue_matters)    lines.push(`What Matters Most: ${lead.venue_matters}`);
  if (typeof lead.guest_count === 'number') lines.push(`Guest Count: ${lead.guest_count}`);
  if (lead.message)          lines.push(`Message: ${lead.message}`);

  const utm = [
    lead.utm_source   && `source=${lead.utm_source}`,
    lead.utm_medium   && `medium=${lead.utm_medium}`,
    lead.utm_campaign && `campaign=${lead.utm_campaign}`,
    lead.utm_term     && `term=${lead.utm_term}`,
    lead.utm_content  && `content=${lead.utm_content}`,
  ].filter(Boolean);
  if (utm.length) lines.push(`Attribution: ${utm.join(', ')}`);

  return lines.join('\n');
}

/**
 * Best-effort note attachment. Never throws — a failed note must not fail the
 * whole lead push, since the booking itself already carries the essentials.
 */
async function attachNote(
  apiKey: string,
  orgId: string,
  bookingId: string,
  content: string,
): Promise<void> {
  try {
    await fetch(`${EVENTTEMPLE_API}/notes`, {
      method: 'POST',
      headers: etHeaders(apiKey, orgId),
      body: JSON.stringify({
        data: {
          type: 'notes',
          attributes: {
            content,
            notable_type: 'Booking',
            notable_id: Number(bookingId),
          },
        },
      }),
    });
  } catch (e) {
    console.warn('[eventtemple] attachNote failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * Push a single lead to Event Temple as a booking (status=lead) with an
 * embedded new contact. Fire-and-forget safe — never throws; returns
 * { ok, error } instead so callers can log without crashing.
 */
export async function pushLeadToEventTemple(
  apiKey: string,
  orgId: string,
  lead: EventTempleLead,
): Promise<{ ok: boolean; bookingId?: string; error?: string }> {
  try {
    // Event Temple requires first_name, last_name and email on a new contact.
    const firstName = (lead.first_name ?? '').trim() || 'Website';
    const lastName  = (lead.last_name ?? '').trim() || 'Lead';
    const email     = (lead.email ?? '').trim();
    if (!email) return { ok: false, error: 'Event Temple requires an email address.' };

    const attributes: Record<string, unknown> = {
      name: `${firstName} ${lastName}`.trim() || 'Website Lead',
      status: 'lead',
      contact: {
        first_name: firstName,
        last_name: lastName,
        email,
        ...(lead.phone_number ? { phone_number: lead.phone_number } : {}),
      },
    };

    // Map the wedding date onto the booking dates when we have it.
    const eventDate = lead.wedding_date?.slice(0, 10);
    if (eventDate) {
      attributes.start_date = eventDate;
      attributes.end_date = eventDate;
    }

    const res = await fetch(`${EVENTTEMPLE_API}/bookings`, {
      method: 'POST',
      headers: etHeaders(apiKey, orgId),
      body: JSON.stringify({ data: { type: 'bookings', attributes } }),
    });

    const json = await res.json().catch(() => ({})) as {
      data?: { id?: string };
      errors?: Array<{ detail?: string; title?: string }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      const detail =
        json.errors?.map((e) => e.detail || e.title).filter(Boolean).join('; ') ||
        json.error?.message ||
        JSON.stringify(json).slice(0, 300);
      return { ok: false, error: `Event Temple ${res.status}: ${detail}` };
    }

    const bookingId = json.data?.id ? String(json.data.id) : undefined;

    // Attach the source + supplemental details as a note (best effort).
    if (bookingId) {
      await attachNote(apiKey, orgId, bookingId, buildEventTempleNote(lead));
    }

    return { ok: true, bookingId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * If this venue has Event Temple connected, push the lead in the background.
 * Reads credentials from the venue row — never throws.
 */
export async function maybePushLeadToEventTemple(
  venueId: string,
  lead: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    wedding_date?: string | null;
    guest_count?: number | null;
    message?: string | null;
    booking_timeline?: string | null;
    venue_matters?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_term?: string | null;
    utm_content?: string | null;
  },
): Promise<void> {
  try {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('eventtemple_api_key, eventtemple_org_id')
      .eq('id', venueId)
      .maybeSingle();

    const v = venue as { eventtemple_api_key?: string | null; eventtemple_org_id?: string | null } | null;
    if (!v?.eventtemple_api_key || !v?.eventtemple_org_id) return;

    const result = await pushLeadToEventTemple(
      v.eventtemple_api_key,
      v.eventtemple_org_id,
      {
        first_name:       lead.first_name ?? undefined,
        last_name:        lead.last_name ?? undefined,
        email:            lead.email ?? undefined,
        phone_number:     lead.phone ?? undefined,
        wedding_date:     lead.wedding_date ?? undefined,
        guest_count:      lead.guest_count ?? undefined,
        message:          lead.message ?? undefined,
        booking_timeline: lead.booking_timeline ?? undefined,
        venue_matters:    lead.venue_matters ?? undefined,
        utm_source:       lead.utm_source ?? undefined,
        utm_medium:       lead.utm_medium ?? undefined,
        utm_campaign:     lead.utm_campaign ?? undefined,
        utm_term:         lead.utm_term ?? undefined,
        utm_content:      lead.utm_content ?? undefined,
      },
    );

    if (!result.ok) {
      console.warn(`[eventtemple] push failed for venue ${venueId}:`, result.error);
    } else {
      console.log(`[eventtemple] lead pushed for venue ${venueId}, booking id:`, result.bookingId);
    }
  } catch (e) {
    console.warn('[eventtemple] maybePushLeadToEventTemple error:', e instanceof Error ? e.message : e);
  }
}
