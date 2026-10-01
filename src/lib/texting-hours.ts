/**
 * When an automated text may go out: 9 am to 9 pm in the couple's own time
 * zone (the owner's rule, Sep 30, 2026).
 *
 * The couple's zone comes from their phone's area code (lib/phone-timezone).
 * When the area code spans two zones, the window is the hours that are
 * daytime in both. Without a usable area code, the venue's time zone stands
 * in. Covers automated follow-ups only; an instant reply to something the
 * couple just did (the guide text right after their form) and appointment
 * reminders are not held.
 *
 * Pure: no I/O.
 */

import { zonesForPhone } from '@/lib/phone-timezone';
import { resolveVenueTimezone } from '@/lib/venue-timezone';

export const TEXTING_START_HOUR = 9;   // 9:00 am
export const TEXTING_END_HOUR = 21;    // 9:00 pm, exclusive

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes past local midnight in `tz`. */
function localMinutes(at: Date, tz: string): number {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    formatters.set(tz, f);
  }
  let h = 0, m = 0;
  for (const p of f.formatToParts(at)) {
    if (p.type === 'hour') h = Number(p.value);
    else if (p.type === 'minute') m = Number(p.value);
  }
  return (h % 24) * 60 + m;
}

/** The zone(s) whose daytime a text to this phone must respect. */
export function textingZones(phone: string | null | undefined, venueTimezone: string | null | undefined): string[] {
  const zones = zonesForPhone(phone);
  return zones.length ? zones : [resolveVenueTimezone(venueTimezone)];
}

/** Is `at` between 9 am and 9 pm in every one of these zones? */
export function insideTextingHours(at: Date, zones: string[]): boolean {
  return zones.every((tz) => {
    const mins = localMinutes(at, tz);
    return mins >= TEXTING_START_HOUR * 60 && mins < TEXTING_END_HOUR * 60;
  });
}

/**
 * The first moment at or after `at` that is inside the window for every zone
 * (searched in 5-minute steps, up to three days ahead).
 */
export function nextTextingTime(at: Date, zones: string[]): Date {
  if (insideTextingHours(at, zones)) return at;
  const step = 5 * 60_000;
  let t = new Date(Math.ceil(at.getTime() / step) * step);
  for (let i = 0; i < 3 * 24 * 12; i++) {
    if (insideTextingHours(t, zones)) return t;
    t = new Date(t.getTime() + step);
  }
  // No common daytime found (no area code in the table does this); don't hold
  // the text forever.
  return at;
}
