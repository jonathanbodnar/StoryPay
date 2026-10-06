/**
 * "Every venue session in this browser from before this moment is over."
 *
 * Why it exists (found Oct 5 2026): the proxy renews a session's cookies on
 * every signed-in answer. An answer still on its way when someone pressed
 * Logout arrived after the logout and put the cookies back, so the browser
 * showed the sign-in page while still being signed in. Pressed within a
 * second of a page opening that happened every time; with the app running
 * slow, every time at any moment. Signing in over an older session had the
 * mirror problem: a late renewal of the old one could put the browser back in
 * the OLD account.
 *
 * So ending a session, and starting one, also leaves this marker: the time it
 * happened. A renewed session keeps its original issue time, which is before
 * the marker, and the proxy refuses it. A session started afterwards is newer
 * than the marker and is fine.
 *
 * Nothing here needs a secret: the marker can only ever refuse sessions, in
 * the browser that holds it. This file imports nothing, so the proxy can use it.
 */

export const SESSION_ENDED_COOKIE = 'sv_sessions_ended';

/**
 * The marker is written a little in the past, so a sign-in a moment later is
 * never older than it, even if two servers' clocks disagree slightly.
 */
export const SESSION_ENDED_SLACK_SECONDS = 2;

/** As long as the longest session there is (the phone app's 90 days), so the marker outlives anything it ended. */
export const SESSION_ENDED_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

/** A marker further ahead than this is not one this app wrote, and is ignored. */
const FUTURE_TOLERANCE_SECONDS = 300;

/** A session's issue time is the first part of its `<name>_meta` cookie. */
export function issuedAt(meta: string | null | undefined): number | null {
  const first = String(meta ?? '').split('.')[0];
  if (!/^\d{1,12}$/.test(first)) return null;
  const iat = Number(first);
  return iat > 0 ? iat : null;
}

/**
 * What to store when sessions end (or one starts) at `nowSecs`.
 *
 * `endedIats` are the issue times of the sessions being ended, when they're
 * known (logging out knows them: they're in the request). The marker is then
 * at least a second past the newest of them, so the session being logged out
 * of is over even if it was only a moment old. Without that, the slack above
 * would spare any session issued in the two seconds before.
 */
export function sessionsEndedValue(nowSecs: number, endedIats: ReadonlyArray<number | null | undefined> = []): string {
  const now = Math.floor(nowSecs);
  const known = endedIats.filter((i): i is number => typeof i === 'number' && Number.isFinite(i));
  // (An issue time far ahead of now isn't one to build on.)
  const pastTheNewest = known.length ? Math.min(Math.max(...known) + 1, now + 60) : 0;
  return String(Math.max(now - SESSION_ENDED_SLACK_SECONDS, pastTheNewest));
}

/** The moment the marker cookie names (unix seconds); 0 when there is none worth trusting. */
export function sessionsEndedAt(marker: string | null | undefined, nowSecs: number): number {
  if (!marker || !/^\d{1,12}$/.test(marker)) return 0;
  const at = Number(marker);
  if (at <= 0 || at > nowSecs + FUTURE_TOLERANCE_SECONDS) return 0;
  return at;
}

/**
 * Is a session issued at `iat` over, given the marker? A session with no
 * issue time at all (the oldest cookie format) can't be shown to be newer
 * than the marker, so it is over too.
 */
export function sessionIsOver(iat: number | null, endedAt: number): boolean {
  if (endedAt <= 0) return false;
  return iat === null || !Number.isFinite(iat) || iat < endedAt;
}
