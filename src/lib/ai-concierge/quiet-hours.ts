/**
 * Quiet hours helper for the AI Concierge.
 *
 * Send window: 9:00 am – 9:00 pm in the venue's registered timezone.
 * Any send scheduled outside that window is pushed forward to the next
 * 9 am in that same timezone. The venue timezone comes from venues.timezone
 * and is resolved via resolveVenueTimezone (falls back to America/New_York).
 */

import { formatInTimeZone } from 'date-fns-tz';
import {
  resolveVenueTimezone,
  wallClockToUtc,
  addCalendarDaysYmd,
} from '@/lib/venue-timezone';

/** Send window in venue-local hours (24h). Inclusive start, exclusive end. */
export const QUIET_HOURS_START_LOCAL_HH = 9;   // 09:00 am
export const QUIET_HOURS_END_LOCAL_HH   = 21;  // 09:00 pm — no sends at/after this hour

/**
 * If `t` is inside quiet hours (before 9am OR at/after 9pm venue-local),
 * advance to the next 9am venue-local.
 *
 * If `t` is already inside the send window (9am–9pm), return it unchanged.
 */
export function enforceQuietHours(t: Date, timezone: string | null | undefined): Date {
  const tz = resolveVenueTimezone(timezone);

  const localDate = formatInTimeZone(t, tz, 'yyyy-MM-dd');
  const localHour = parseInt(formatInTimeZone(t, tz, 'H'), 10);

  // Inside the send window — leave as-is
  if (localHour >= QUIET_HOURS_START_LOCAL_HH && localHour < QUIET_HOURS_END_LOCAL_HH) {
    return t;
  }

  // Before 9am local → push to today 9am local
  if (localHour < QUIET_HOURS_START_LOCAL_HH) {
    return wallClockToUtc(localDate, '09:00', tz);
  }

  // At/after 9pm local → push to tomorrow 9am local
  const tomorrow = addCalendarDaysYmd(localDate, 1, tz);
  return wallClockToUtc(tomorrow, '09:00', tz);
}

/**
 * Convenience: is this instant currently outside the 9am–9pm send window?
 */
export function isInsideQuietHours(t: Date, timezone: string | null | undefined): boolean {
  const tz = resolveVenueTimezone(timezone);
  const h  = parseInt(formatInTimeZone(t, tz, 'H'), 10);
  return h < QUIET_HOURS_START_LOCAL_HH || h >= QUIET_HOURS_END_LOCAL_HH;
}
