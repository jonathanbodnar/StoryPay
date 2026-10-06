/**
 * What on the test copy is a leftover of an earlier test run, and so can go.
 *
 * Every test run names what it creates after itself: its run id (the time it
 * started, in base 36: tests/flows/helpers.ts `runId`) is the last word of a
 * venue's name ("Guide Journey muwwu34m") and a part of every email address it
 * makes up ("guide.desktop-muwx01ab.muwwu34m@example.com"). Nothing deleted
 * them, and a run leaves about a hundred venues behind. By Oct 6 2026 that was
 * 855 venues, and the nightly tag sweep, which walks the whole database, took
 * 68 seconds there and failed the checks.
 *
 * A leftover is something made by a run that started long enough ago to be
 * over. Anything without a run id in it (the seeded venues, the showcase
 * venue, the fixed test accounts) is never one. Pure: tests/unit/tidy-rule.test.ts.
 */

/** Runs are over well within this; nothing younger is touched. */
export const LEFTOVER_AFTER_MS = 2 * 60 * 60 * 1000;

/** The test copy was first filled in September 2026: no run id is older. */
const EARLIEST_RUN_MS = Date.parse('2026-09-01T00:00:00Z');

/** When the run this token names started (ms), or null if it isn't a run id. */
export function runTime(token, nowMs) {
  if (typeof token !== 'string' || !/^[0-9a-z]{8,9}$/.test(token)) return null;
  const at = parseInt(token, 36);
  if (!Number.isFinite(at) || at < EARLIEST_RUN_MS || at > nowMs + 24 * 60 * 60 * 1000) return null;
  return at;
}

/** The newest run time named anywhere in these texts, or null. */
function newestRunTime(texts, nowMs) {
  let newest = null;
  for (const text of texts) {
    for (const token of String(text ?? '').toLowerCase().split(/[^0-9a-z]+/)) {
      // The run id is a word of its own ("guide.muwwu34m") or the end of one
      // ("morgan.livephonemuq6mcx7").
      const at = runTime(token, nowMs) ?? (token.length > 8 ? runTime(token.slice(-8), nowMs) : null);
      if (at !== null && (newest === null || at > newest)) newest = at;
    }
  }
  return newest;
}

const made = (email) => /@example\.com$/i.test(String(email ?? ''));

/** Is this venue a leftover of a run that is over? */
export function leftoverVenue(venue, nowMs, afterMs = LEFTOVER_AFTER_MS) {
  if (!made(venue.email)) return false;
  // The local part only: "example" is not a run id, but don't lean on that.
  const at = newestRunTime([venue.name, venue.slug, String(venue.email).split('@')[0]], nowMs);
  return at !== null && nowMs - at >= afterMs;
}

/**
 * Is this sign-in (a couple, or a venue owner who signed up) a leftover of a
 * run that is over? The same question answers for a lead, a contact or a
 * proposal inside a venue that stays (the shared Flow Test Venue collects most
 * of what the runs make: 1,313 leads and 544 proposals by Oct 6 2026).
 */
export function leftoverUser(email, nowMs, afterMs = LEFTOVER_AFTER_MS) {
  if (!made(email)) return false;
  const at = newestRunTime([String(email).split('@')[0]], nowMs);
  return at !== null && nowMs - at >= afterMs;
}
