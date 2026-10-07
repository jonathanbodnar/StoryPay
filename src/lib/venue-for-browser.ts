/**
 * A venue's own record, as its browsers may have it.
 *
 * `/api/venues/me` answers every signed-in session of a venue, the owner's
 * and each team member's, and until Oct 7 2026 it sent the whole row with
 * three tokens masked. The rest went along: the owner's password hash, the
 * emailed sign-in link's token and the admin sign-in token (either one signs
 * in as the owner), the texting account's location token, the old payment
 * processor's secret key, the Calendly and Event Temple keys. A team member
 * could read them all; no screen uses any of them.
 *
 *  - What signs someone in, and what a third party's key can do, never leaves
 *    the server.
 *  - A connection's key that a settings screen shows as "on file" leaves as
 *    dots and its last four characters.
 *  - A column added later whose name says it is a secret is left out too,
 *    until someone decides otherwise here.
 */

/** Shown as "on file": dots and the last four characters. */
const ON_FILE = new Set(['ghl_access_token', 'ghl_location_token', 'meta_capi_access_token', 'calendly_access_token', 'eventtemple_api_key']);

/** Only whether there is one. */
const PRESENT_ONLY = new Set(['ghl_refresh_token']);

/** Named like a secret, and not one: these stay as they are. */
const NOT_SECRET = new Set(['lunarpay_publishable_key', 'tripleseat_public_key']);

/** A column whose name says it holds a secret. */
const LOOKS_SECRET = /(password|secret|_hash$|_token$|signing_key$|api_key$|private_key|session_invalidated)/i;

export function venueForBrowser<T extends Record<string, unknown>>(venue: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(venue)) {
    if (ON_FILE.has(column)) {
      out[column] = typeof value === 'string' && value ? `••••${value.slice(-4)}` : null;
    } else if (PRESENT_ONLY.has(column)) {
      out[column] = typeof value === 'string' && value ? '••••' : null;
    } else if (NOT_SECRET.has(column) || !LOOKS_SECRET.test(column)) {
      out[column] = value;
    }
  }
  return out;
}
