/**
 * How a name in the venue's Event Temple account is compared with the one we
 * look for. Case, spacing and the trademark sign don't count: the card and the
 * Help Center tell a venue to create "StoryVenue - Bride Booking System", and
 * the label we send carries the sign.
 */
export function normalizeEventTempleName(s: string): string {
  return s.replace(/[\u2122\u00ae]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}
