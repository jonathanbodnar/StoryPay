import { formatInTimeZone, toDate } from 'date-fns-tz';

/** Default when legacy rows have no timezone set */
export const DEFAULT_VENUE_TIMEZONE = 'America/New_York';

/** Normalize venue timezone from API (null/empty → default). */
export function resolveVenueTimezone(raw: string | null | undefined): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  return t || DEFAULT_VENUE_TIMEZONE;
}

let cachedZones: string[] | null = null;

/** Short name from the environment (e.g. EST, MST, GMT+9) — varies by browser and DST. */
function getIntlShortTimeZoneName(timeZone: string, date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * Label for timezone `<select>` options: IANA id, short abbreviation, and GMT/UTC offset.
 * Example: `America/New_York (EST, GMT-05:00)`
 */
export function formatTimeZoneOptionLabel(iana: string, refDate: Date = new Date()): string {
  const tz = (iana || '').trim() || DEFAULT_VENUE_TIMEZONE;
  const short = getIntlShortTimeZoneName(tz, refDate);
  let offset = '';
  try {
    offset = formatInTimeZone(refDate, tz, 'xxx');
  } catch {
    offset = '';
  }
  const gmt = offset ? `GMT${offset}` : '';
  if (short && gmt) {
    return `${tz} (${short}, ${gmt})`;
  }
  if (gmt) return `${tz} (${gmt})`;
  if (short) return `${tz} (${short})`;
  return tz;
}

/** Sorted IANA zones for pickers (browser) or a short fallback on the server. */
export function getIanaTimeZoneOptions(): string[] {
  if (cachedZones) return cachedZones;
  try {
    if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
      cachedZones = [...(Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone')].sort();
      return cachedZones;
    }
  } catch {
    /* ignore */
  }
  cachedZones = FALLBACK_TIMEZONES;
  return cachedZones;
}

const FALLBACK_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Australia/Sydney',
  'UTC',
];

/** YYYY-MM-DD of an instant in a given IANA zone. */
export function dateStrInTimeZone(isoUtc: string, timeZone: string): string {
  return formatInTimeZone(new Date(isoUtc), resolveVenueTimezone(timeZone), 'yyyy-MM-dd');
}

/**
 * Sunday = 0 … Saturday = 6 for the calendar wall date of `isoUtc` in `timeZone`.
 * Uses ISO weekday from format token `i` (Mon=1 … Sun=7).
 */
export function sun0WeekdayInTimeZone(isoUtc: string | Date, timeZone: string): number {
  const tz = resolveVenueTimezone(timeZone);
  const d = typeof isoUtc === 'string' ? new Date(isoUtc) : isoUtc;
  const isoD = parseInt(formatInTimeZone(d, tz, 'i'), 10);
  return isoD === 7 ? 0 : isoD;
}

export function addCalendarDaysYmd(ymd: string, days: number, timeZone: string): string {
  const tz = resolveVenueTimezone(timeZone);
  const mid = toDate(`${ymd}T12:00:00`, { timeZone: tz });
  const next = new Date(mid.getTime() + days * 86400000);
  return formatInTimeZone(next, tz, 'yyyy-MM-dd');
}

/** Fractional hour (0–24) of this instant in `timeZone` (for agenda layout). */
export function hourFloatInTimeZone(isoUtc: string | Date, timeZone: string): number {
  const tz = resolveVenueTimezone(timeZone);
  const d = typeof isoUtc === 'string' ? new Date(isoUtc) : isoUtc;
  const h = parseInt(formatInTimeZone(d, tz, 'H'), 10);
  const m = parseInt(formatInTimeZone(d, tz, 'm'), 10);
  const s = parseInt(formatInTimeZone(d, tz, 's'), 10);
  return h + m / 60 + s / 3600;
}

/** HH:mm (24h) in venue zone from UTC ISO. */
export function timeStrInTimeZone(isoUtc: string, timeZone: string): string {
  return formatInTimeZone(new Date(isoUtc), resolveVenueTimezone(timeZone), 'HH:mm');
}

/**
 * Interpret wall-clock date + time as local in `timeZone` and return UTC Date.
 */
export function wallClockToUtc(dateYmd: string, timeHHmm: string, timeZone: string): Date {
  const tz = resolveVenueTimezone(timeZone);
  const s = `${dateYmd}T${timeHHmm}:00`;
  return toDate(s, { timeZone: tz });
}

export function isProbablyValidIanaTimeZone(id: string): boolean {
  const t = id.trim();
  if (!t) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: t });
    return true;
  } catch {
    return false;
  }
}

/** Start/end of a calendar day in venue TZ → UTC Dates. */
export function venueDayBoundsUtc(dateYmd: string, timeZone: string): { start: Date; end: Date } {
  const tz = resolveVenueTimezone(timeZone);
  const start = toDate(`${dateYmd}T00:00:00`, { timeZone: tz });
  const end = toDate(`${dateYmd}T23:59:59.999`, { timeZone: tz });
  return { start, end };
}
