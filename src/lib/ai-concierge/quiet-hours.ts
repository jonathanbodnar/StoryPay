/**
 * Quiet hours helper for the AI Concierge.
 *
 * Quiet hours are defined as 9:00–20:00 in the venue's local timezone
 * (matching `ai_config.message_constraints.quiet_hours_start_local` /
 * `quiet_hours_end_local`). Outside that window, AI sends are deferred to
 * the next 9am venue-local.
 */

import { formatInTimeZone } from 'date-fns-tz';
import {
  resolveVenueTimezone,
  wallClockToUtc,
  addCalendarDaysYmd,
} from '@/lib/venue-timezone';

/** Send window in venue-local hours (24h). Inclusive start, exclusive end. */
export const QUIET_HOURS_START_LOCAL_HH = 9;   // 09:00
export const QUIET_HOURS_END_LOCAL_HH   = 20;  // 20:00

/**
 * If `t` is inside quiet hours (before 9am OR at/after 8pm venue-local),
 * advance to the next 9am venue-local.
 *
 * If `t` is already inside the send window, return it unchanged.
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

  // At/after 8pm local → push to tomorrow 9am local
  const tomorrow = addCalendarDaysYmd(localDate, 1, tz);
  return wallClockToUtc(tomorrow, '09:00', tz);
}

/**
 * Convenience: is this instant currently inside the send window?
 */
export function isInsideQuietHours(t: Date, timezone: string | null | undefined): boolean {
  const tz = resolveVenueTimezone(timezone);
  const h  = parseInt(formatInTimeZone(t, tz, 'H'), 10);
  return h < QUIET_HOURS_START_LOCAL_HH || h >= QUIET_HOURS_END_LOCAL_HH;
}
