import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

/**
 * GET /api/calendar/slots?date=YYYY-MM-DD
 *
 * Returns available time slots for a given date based on:
 * 1. The venue's weekly availability schedule
 * 2. Date-specific overrides
 * 3. Existing calendar_events (conflicts)
 * 4. Booking rules (duration, interval, buffer times)
 */
export async function GET(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get('date');
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: 'date param (YYYY-MM-DD) required' }, { status: 400 });
  }

  // Fetch settings
  const { data: settings } = await supabaseAdmin
    .from('venue_calendar_settings')
    .select('timezone, meeting_duration_min, meeting_interval_min, pre_buffer_min, post_buffer_min')
    .eq('venue_id', venueId)
    .maybeSingle();

  const tz = settings?.timezone ?? 'America/New_York';
  const duration = settings?.meeting_duration_min ?? 60;
  const interval = settings?.meeting_interval_min ?? 60;
  const preBuffer = settings?.pre_buffer_min ?? 0;
  const postBuffer = settings?.post_buffer_min ?? 0;

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

  // Build slot list from window
  const [startH, startM] = windowStart.split(':').map(Number);
  const [endH, endM] = windowEnd.split(':').map(Number);
  const windowStartMin = startH * 60 + startM;
  const windowEndMin = endH * 60 + endM;

  // Fetch existing events on this date (use UTC range for the day in the venue's timezone)
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

  const { data: events } = await supabaseAdmin
    .from('calendar_events')
    .select('start_at, end_at')
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .gte('start_at', dayStart.toISOString())
    .lte('end_at', dayEnd.toISOString());

  // Convert existing events to minute-of-day blocked ranges (using venue timezone logic for simplicity)
  const blockedRanges = (events ?? []).map((e) => {
    const s = new Date(e.start_at);
    const en = new Date(e.end_at);
    const sMin = s.getUTCHours() * 60 + s.getUTCMinutes();
    const eMin = en.getUTCHours() * 60 + en.getUTCMinutes();
    return { start: sMin - preBuffer, end: eMin + postBuffer };
  });

  const slots: Array<{ time: string; label: string; available: boolean }> = [];

  for (let m = windowStartMin; m + duration <= windowEndMin; m += interval) {
    const slotEnd = m + duration;
    const conflicted = blockedRanges.some((b) => m < b.end && slotEnd > b.start);
    const h = Math.floor(m / 60);
    const min = m % 60;
    const ampm = h < 12 ? 'AM' : 'PM';
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const label = `${displayH}:${min.toString().padStart(2, '0')} ${ampm}`;
    slots.push({ time: `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`, label, available: !conflicted });
  }

  return NextResponse.json({ slots, timezone: tz });
}
