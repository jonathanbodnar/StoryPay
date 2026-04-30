/**
 * Google Calendar push helpers — SaaS → Google sync.
 *
 * Used by /api/calendar (POST/PATCH/DELETE) and the lead/contact appointment
 * routes so that events created/edited/deleted inside StoryVenue propagate
 * out to the venue owner's Google Calendar.
 *
 * Read-side counterpart: /api/calendar/google/events (Google → SaaS).
 *
 * All functions are best-effort and never throw — failures are logged so
 * the SaaS write path always succeeds even if Google is briefly unavailable.
 */

import { supabaseAdmin } from '@/lib/supabase';

interface GoogleEventInput {
  /** Event title shown on the calendar */
  title: string;
  /** ISO start datetime (UTC) */
  start_at: string;
  /** ISO end datetime (UTC) */
  end_at: string;
  /** Whether the event is all-day */
  all_day?: boolean;
  /** Optional description (notes) */
  notes?: string | null;
  /** Optional location string */
  location?: string | null;
  /** Optional attendee emails — Google will email them an invite */
  attendees?: string[];
  /** Optional time zone label, defaults to UTC */
  time_zone?: string | null;
}

interface GoogleEventLink {
  google_event_id: string;
  google_calendar_id: string;
  html_link?: string | null;
}

/** Refresh the OAuth access token using the stored refresh token. */
async function refreshAccessToken(venueId: string, refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) return null;
    const { access_token, expires_in } = await res.json();
    const expiry = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();
    await supabaseAdmin
      .from('venue_calendar_settings')
      .update({ google_access_token: access_token, google_token_expiry: expiry })
      .eq('venue_id', venueId);
    return access_token as string;
  } catch (e) {
    console.error('[google-calendar-push] refreshAccessToken error:', e);
    return null;
  }
}

/**
 * Resolve a usable Google access token + the calendar ID to write to.
 * Returns null when the venue isn't connected or auth has fully failed.
 */
async function resolveGoogleAuth(venueId: string): Promise<{
  token: string;
  calendarId: string;
} | null> {
  const { data: settings } = await supabaseAdmin
    .from('venue_calendar_settings')
    .select('google_connected, google_access_token, google_refresh_token, google_token_expiry, google_linked_calendar_id')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!settings?.google_connected || !settings.google_access_token) return null;

  let token = settings.google_access_token as string;

  // Refresh proactively when within 60s of expiry, or already past
  const expiry = settings.google_token_expiry ? new Date(settings.google_token_expiry as string) : null;
  const needsRefresh = !!expiry && expiry.getTime() - Date.now() < 60_000;
  if (needsRefresh && settings.google_refresh_token) {
    const refreshed = await refreshAccessToken(venueId, settings.google_refresh_token as string);
    if (refreshed) token = refreshed;
  }

  const calendarId = (settings.google_linked_calendar_id as string | null) ?? 'primary';
  return { token, calendarId };
}

/** Convert StoryVenue event input to Google Calendar API event body. */
function toGoogleEventBody(input: GoogleEventInput): Record<string, unknown> {
  const tz = input.time_zone || 'UTC';
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.notes ?? undefined,
    location: input.location ?? undefined,
  };

  if (input.all_day) {
    // All-day events use `date` (YYYY-MM-DD), not `dateTime`.
    body.start = { date: input.start_at.slice(0, 10) };
    body.end   = { date: input.end_at.slice(0, 10) };
  } else {
    body.start = { dateTime: input.start_at, timeZone: tz };
    body.end   = { dateTime: input.end_at,   timeZone: tz };
  }

  if (input.attendees && input.attendees.length > 0) {
    body.attendees = input.attendees.map((email) => ({ email }));
  }

  return body;
}

/**
 * Insert a new event into the venue's primary Google Calendar.
 * Returns the resulting google_event_id + calendar_id, or null on failure.
 */
export async function pushEventCreateToGoogle(
  venueId: string,
  input: GoogleEventInput,
): Promise<GoogleEventLink | null> {
  try {
    const auth = await resolveGoogleAuth(venueId);
    if (!auth) return null;

    const body = toGoogleEventBody(input);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(auth.calendarId)}/events?sendUpdates=none`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[google-calendar-push] insert failed', res.status, txt);
      return null;
    }
    const event = await res.json() as { id?: string; htmlLink?: string };
    if (!event.id) return null;
    return {
      google_event_id: event.id,
      google_calendar_id: auth.calendarId,
      html_link: event.htmlLink ?? null,
    };
  } catch (e) {
    console.error('[google-calendar-push] insert error:', e);
    return null;
  }
}

/**
 * PATCH an existing Google event with the latest fields.
 * No-op (returns false) when the event has no google_event_id linkage yet.
 */
export async function pushEventUpdateToGoogle(
  venueId: string,
  link: { google_event_id: string | null; google_calendar_id: string | null },
  input: GoogleEventInput,
): Promise<boolean> {
  if (!link.google_event_id) return false;
  try {
    const auth = await resolveGoogleAuth(venueId);
    if (!auth) return false;

    const calId = link.google_calendar_id || auth.calendarId;
    const body = toGoogleEventBody(input);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(link.google_event_id)}?sendUpdates=none`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[google-calendar-push] patch failed', res.status, txt);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[google-calendar-push] patch error:', e);
    return false;
  }
}

/**
 * Delete an event from Google Calendar.
 * No-op (returns false) when the event has no google_event_id linkage.
 */
export async function pushEventDeleteToGoogle(
  venueId: string,
  link: { google_event_id: string | null; google_calendar_id: string | null },
): Promise<boolean> {
  if (!link.google_event_id) return false;
  try {
    const auth = await resolveGoogleAuth(venueId);
    if (!auth) return false;

    const calId = link.google_calendar_id || auth.calendarId;
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(link.google_event_id)}?sendUpdates=none`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    // 410 Gone = already deleted, treat as success
    if (!res.ok && res.status !== 410) {
      const txt = await res.text().catch(() => '');
      console.error('[google-calendar-push] delete failed', res.status, txt);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[google-calendar-push] delete error:', e);
    return false;
  }
}
