import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

async function refreshAccessToken(venueId: string, refreshToken: string): Promise<string | null> {
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
}

async function fetchCalendarEvents(
  token: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  calendarName: string,
): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return ((data.items ?? []) as Array<{
    id: string;
    summary?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    status?: string;
    description?: string;
    htmlLink?: string;
  }>)
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({
      id: `google_${calendarId}_${e.id}`,
      google_event_id: e.id,
      google_calendar_id: calendarId,
      google_calendar_name: calendarName,
      title: e.summary ?? '(No title)',
      start_at: e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null),
      end_at: e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T23:59:59Z` : null),
      all_day: !e.start?.dateTime,
      notes: e.description ?? null,
      html_link: e.htmlLink ?? null,
      source: 'google',
      event_type: 'google',
      status: 'confirmed',
      // Mark as read-only so the UI knows not to offer edit/delete
      read_only: true,
    }));
}

/**
 * GET /api/calendar/google/events?from=...&to=...
 *
 * Returns events from all connected Google Calendars (primary + all
 * conflict calendars) for the given time window.
 */
export async function GET(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to   = searchParams.get('to');

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to params required' }, { status: 400 });
  }

  const { data: settings } = await supabaseAdmin
    .from('venue_calendar_settings')
    .select('google_connected, google_access_token, google_refresh_token, google_token_expiry, google_linked_calendar_id, google_account_email')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!settings?.google_connected || !settings.google_access_token) {
    return NextResponse.json([]); // Not connected — return empty
  }

  let token = settings.google_access_token as string;

  // Refresh token if expired
  const expiry = settings.google_token_expiry ? new Date(settings.google_token_expiry as string) : null;
  if (expiry && expiry < new Date() && settings.google_refresh_token) {
    const refreshed = await refreshAccessToken(venueId, settings.google_refresh_token as string);
    if (refreshed) token = refreshed;
  }

  // Get all conflict calendars so we can fetch from each
  const { data: conflictCals } = await supabaseAdmin
    .from('venue_conflict_calendars')
    .select('google_calendar_id, calendar_name')
    .eq('venue_id', venueId);

  // Build deduplicated list of calendars to fetch from:
  // always include the primary/linked calendar, plus all conflict calendars
  const calendarMap = new Map<string, string>(); // id → display name

  // Primary calendar — use 'primary' as the Google special ID
  const primaryId = (settings.google_linked_calendar_id as string | null) ?? 'primary';
  const primaryLabel = (settings.google_account_email as string) ?? 'My Calendar';
  calendarMap.set(primaryId, primaryLabel);

  for (const cc of (conflictCals ?? [])) {
    calendarMap.set(cc.google_calendar_id, cc.calendar_name ?? cc.google_calendar_id);
  }

  // Fetch events from each calendar in parallel
  const results = await Promise.allSettled(
    Array.from(calendarMap.entries()).map(([calId, calName]) =>
      fetchCalendarEvents(token, calId, from, to, calName)
    )
  );

  const allEvents: Array<Record<string, unknown>> = [];
  for (const r of results) {
    if (r.status === 'fulfilled') allEvents.push(...r.value);
  }

  // Deduplicate by google_event_id in case the same event appears on multiple
  // calendars (e.g., the primary calendar is also a conflict calendar)
  const seen = new Set<string>();
  const deduped = allEvents.filter((e) => {
    const key = String(e.google_event_id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json(deduped);
}
