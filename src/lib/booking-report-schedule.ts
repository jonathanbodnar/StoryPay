const PERIOD_MS = 30 * 86_400_000;

/**
 * When a scheduled booking report is next due, after the one due at
 * `scheduledAt`: 30-day steps from the original schedule (so a late run
 * doesn't drift the day), skipping periods that already passed, so a schedule
 * set months ago sends once, not once per missed month.
 */
export function nextReportAt(scheduledAt: string, now: number = Date.now()): string {
  let next = new Date(scheduledAt).getTime() + PERIOD_MS;
  if (next <= now) next += Math.ceil((now - next + 1) / PERIOD_MS) * PERIOD_MS;
  return new Date(next).toISOString();
}
