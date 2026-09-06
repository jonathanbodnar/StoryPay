/**
 * Freshness gate for inbound "new reply" notifications.
 *
 * WHY THIS EXISTS: inbound SMS is imported via GHL sync/webhook and stamped
 * with GHL's original `dateAdded` as the message `created_at`. When a thread
 * goes quiet, the inbound poller stops scanning it — the baseline sweep only
 * looks back `activeDays` (14d) and the hot tier only `windowMinutes` (60m),
 * both keyed on SMS activity ALREADY in our DB (see ghl-inbound-sync-cron.ts).
 * So a bride's reply on a long-dormant thread can sit unseen in GHL and only
 * get imported days later, when the thread is next touched (opened in the
 * dashboard, replied to, or hit by a workflow webhook).
 *
 * On that late first-import, insertInboundGhlSms would otherwise fire a loud
 * "New bride reply" Slack ping + owner push/email for a message whose true
 * event time is days old — the 2026-09 "that message is from Thursday…it
 * popped up as new, spooky!" incident (White Pine Manor, GHL message
 * S9qA0sp3scNOxNW1Sqjv, dateAdded 2026-09-03, imported 2026-09-05T20:25:57Z).
 *
 * The message is still inserted + realtime-broadcast (so the inbox stays
 * complete and the thread still surfaces under "needs reply"); we only
 * suppress the real-time "just arrived" alerts when the event time is
 * materially stale. Legitimate fresh replies — ingested within seconds
 * (webhook) to ~70s (baseline cron) — are always well inside the window, so
 * no genuine new-reply alert is ever suppressed.
 */

const DEFAULT_MAX_AGE_MINUTES = 60;

/** Max age (ms) a message's true event time may be and still fire a real-time
 *  "new reply" alert. Tunable via NEW_REPLY_ALERT_MAX_AGE_MINUTES. */
export function newReplyAlertMaxAgeMs(): number {
  const raw = Number.parseInt(process.env.NEW_REPLY_ALERT_MAX_AGE_MINUTES ?? '', 10);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_AGE_MINUTES;
  return minutes * 60 * 1000;
}

/**
 * True when a freshly-imported inbound message is recent enough that a
 * "new reply just arrived" notification is accurate.
 *
 * Fail-open: a missing / unparseable / future-dated timestamp is treated as
 * fresh so we never suppress a legitimate real-time alert. Only a message with
 * a clearly-past event time older than the window is gated.
 */
export function isFreshInboundForAlert(
  createdAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!createdAt) return true;
  const t = Date.parse(String(createdAt));
  if (!Number.isFinite(t)) return true;
  const ageMs = now - t;
  if (ageMs <= 0) return true; // future / clock skew → treat as fresh
  return ageMs <= newReplyAlertMaxAgeMs();
}
