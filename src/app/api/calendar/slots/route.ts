import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveVenueId } from '@/lib/effective-venue';

/**
 * Convert an ISO datetime string to minute-of-day in the given IANA timezone.
 * e.g. "2026-05-01T11:00:00-04:00" in "America/New_York" → 660 (11*60)
 */
function toLocalMinute(isoString: string, tz: string): number {
  const d = new Date(isoString);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  // hour12:false can return 24 for midnight — clamp to 0
  return (h === 24 ? 0 : h) * 60 + m;
}

/**
 * Return the local date string (YYYY-MM-DD) for a UTC instant in the given timezone.
 */
function toLocalDateStr(isoString: string, tz: string): string {
  const d = new Date(isoString);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const mo = parts.find((p) => p.type === 'month')?.value ?? '';
  const da = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${mo}-${da}`;
}

/** Refresh a Google access token and save it back to DB. */
async function refreshGoogleToken(venueId: string, refreshToken: string): Promise<string | null> {
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

/**
 * Fetch events from a single Google Calendar and return {start_at, end_at} pairs.
 * Uses a ±14h UTC window so any local day's events are always captured.
 */
async function fetchGoogleBusyPeriods(
  token: string,
  calendarId: string,
  dateStr: string,
): Promise<Array<{ start_at: string; end_at: string }>> {
  // Build a wide UTC window that covers the full local day regardless of timezone offset
  const base = new Date(`${dateStr}T12:00:00Z`);
  const timeMin = new Date(base.getTime() - 14 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(base.getTime() + 14 * 60 * 60 * 1000).toISOString();

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
    status?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }>)
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({
      start_at: e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : ''),
      end_at: e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : ''),
    }))
    .filter((e) => e.start_at && e.end_at);
}

/**
 * GET /api/calendar/slots?date=YYYY-MM-DD
 *
 * Returns available time slots for a given date based on:
 * 1. The venue's weekly availability schedule
 * 2. Date-specific overrides
 * 3. Existing local calendar_events (conflicts)
 * 4. Google Calendar events (primary + conflict calendars)
 * 5. Booking rules (duration, interval, buffer times)
 */
export async function GET(req: NextRequest) {
  const venueId = await getEffectiveVenueId(req);
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get('date');
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: 'date param (YYYY-MM-DD) required' }, { status: 400 });
  }
  // Optional: override rules with a specific calendar's settings
  const calendarId = searchParams.get('calendar_id');

  type CalSettings = {
    timezone?: string;
    meeting_duration_min?: number;
    meeting_interval_min?: number;
    pre_buffer_min?: number;
    post_buffer_min?: number;
    google_connected?: boolean;
    google_access_token?: string | null;
    google_refresh_token?: string | null;
    google_token_expiry?: string | null;
    google_linked_calendar_id?: string | null;
  };

  type CalendarOverride = {
    meeting_duration_min?:      number | null;
    meeting_interval_min?:      number | null;
    pre_buffer_min?:            number | null;
    post_buffer_min?:           number | null;
    min_scheduling_notice_hrs?: number | null;
    date_range_days?:           number | null;
    max_bookings_per_day?:      number | null;
    max_bookings_per_slot?:     number | null;
  };

  // Fetch venue-wide settings (including Google tokens)
  const [{ data: settings }, calOverrideResult] = await Promise.all([
    supabaseAdmin
      .from('venue_calendar_settings')
      .select(
        'timezone, meeting_duration_min, meeting_interval_min, pre_buffer_min, post_buffer_min, ' +
        'google_connected, google_access_token, google_refresh_token, google_token_expiry, google_linked_calendar_id',
      )
      .eq('venue_id', venueId)
      .maybeSingle() as unknown as Promise<{ data: CalSettings | null }>,

    // Fetch per-calendar overrides if a calendar_id was passed
    calendarId
      ? supabaseAdmin
          .from('venue_calendars')
          .select('meeting_duration_min, meeting_interval_min, pre_buffer_min, post_buffer_min, min_scheduling_notice_hrs, date_range_days, max_bookings_per_day, max_bookings_per_slot')
          .eq('id', calendarId)
          .eq('venue_id', venueId)
          .maybeSingle() as unknown as Promise<{ data: CalendarOverride | null }>
      : Promise.resolve({ data: null as CalendarOverride | null }),
  ]);

  const calOverride = calOverrideResult.data;

  const tz = settings?.timezone ?? 'America/New_York';
  // Per-calendar rules override venue-wide defaults when non-null
  const duration   = calOverride?.meeting_duration_min      ?? settings?.meeting_duration_min ?? 60;
  const interval   = calOverride?.meeting_interval_min      ?? settings?.meeting_interval_min ?? 60;
  const preBuffer  = calOverride?.pre_buffer_min             ?? settings?.pre_buffer_min       ?? 0;
  const postBuffer = calOverride?.post_buffer_min            ?? settings?.post_buffer_min      ?? 0;

  const date = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = date.getDay(); // 0=Sun

  // Check date override first
  const { data: override } = await supabaseAdmin
    .from('venue_date_overrides')
    .select('*')
    .eq('venue_id', venueId)
    .eq('override_date', dateStr)
    .maybeSingle();

  let windowStart: string;
  let windowEnd: string;
  let isAvailable = true;

  if (override) {
    isAvailable = override.is_available;
    windowStart = override.start_time ?? '09:00:00';
    windowEnd = override.end_time ?? '17:00:00';
  } else {
    const { data: avail } = await supabaseAdmin
      .from('venue_availability')
      .select('is_available, start_time, end_time')
      .eq('venue_id', venueId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();

    isAvailable = avail?.is_available ?? (dayOfWeek >= 1 && dayOfWeek <= 5);
    windowStart = avail?.start_time ?? '09:00:00';
    windowEnd = avail?.end_time ?? '17:00:00';
  }

  if (!isAvailable) {
    return NextResponse.json({ slots: [], unavailable: true });
  }

  const [startH, startM] = windowStart.split(':').map(Number);
  const [endH, endM] = windowEnd.split(':').map(Number);
  const windowStartMin = startH * 60 + startM;
  const windowEndMin = endH * 60 + endM;

  // --- Fetch existing LOCAL events on this date ---
  // Use a wide UTC window so we don't miss edge-timezone events
  const base = new Date(`${dateStr}T12:00:00Z`);
  const dayStart = new Date(base.getTime() - 14 * 60 * 60 * 1000).toISOString();
  const dayEnd = new Date(base.getTime() + 14 * 60 * 60 * 1000).toISOString();

  const { data: localEvents } = await supabaseAdmin
    .from('calendar_events')
    .select('start_at, end_at')
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .gte('start_at', dayStart)
    .lte('start_at', dayEnd);

  // Build blocked ranges using LOCAL timezone minutes (not UTC)
  const blockedRanges: Array<{ start: number; end: number }> = [];

  for (const e of localEvents ?? []) {
    if (!e.start_at || !e.end_at) continue;
    // Only block if the event actually falls on the requested local date
    if (toLocalDateStr(e.start_at, tz) !== dateStr) continue;
    const sMin = toLocalMinute(e.start_at, tz);
    const eMin = toLocalMinute(e.end_at, tz);
    blockedRanges.push({ start: sMin - preBuffer, end: eMin + postBuffer });
  }

  // --- Fetch Google Calendar events for this date ---
  if (settings?.google_connected && settings.google_access_token) {
    let token = settings.google_access_token as string;

    // Refresh token if expired
    const expiry = settings.google_token_expiry ? new Date(settings.google_token_expiry as string) : null;
    if (expiry && expiry < new Date() && settings.google_refresh_token) {
      const refreshed = await refreshGoogleToken(venueId, settings.google_refresh_token as string);
      if (refreshed) token = refreshed;
    }

    // Collect all calendar IDs: primary + conflict calendars
    const { data: conflictCals } = await supabaseAdmin
      .from('venue_conflict_calendars')
      .select('google_calendar_id')
      .eq('venue_id', venueId);

    const calendarIds = new Set<string>();
    calendarIds.add((settings.google_linked_calendar_id as string | null) ?? 'primary');
    for (const cc of conflictCals ?? []) {
      calendarIds.add(cc.google_calendar_id);
    }

    // Fetch from all calendars in parallel
    const googleResults = await Promise.allSettled(
      Array.from(calendarIds).map((calId) => fetchGoogleBusyPeriods(token, calId, dateStr)),
    );

    // Deduplicate by start+end
    const seen = new Set<string>();
    for (const result of googleResults) {
      if (result.status !== 'fulfilled') continue;
      for (const e of result.value) {
        const key = `${e.start_at}|${e.end_at}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Only block if it overlaps with the requested local date
        if (toLocalDateStr(e.start_at, tz) !== dateStr) continue;
        const sMin = toLocalMinute(e.start_at, tz);
        const eMin = toLocalMinute(e.end_at, tz);
        blockedRanges.push({ start: sMin - preBuffer, end: eMin + postBuffer });
      }
    }
  }

  // Generate slots
  const slots: Array<{ time: string; label: string; available: boolean }> = [];

  for (let m = windowStartMin; m + duration <= windowEndMin; m += interval) {
    const slotEnd = m + duration;
    const conflicted = blockedRanges.some((b) => m < b.end && slotEnd > b.start);
    const h = Math.floor(m / 60);
    const min = m % 60;
    const ampm = h < 12 ? 'AM' : 'PM';
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const label = `${displayH}:${min.toString().padStart(2, '0')} ${ampm}`;
    slots.push({
      time: `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`,
      label,
      available: !conflicted,
    });
  }

  return NextResponse.json({ slots, timezone: tz });
}
