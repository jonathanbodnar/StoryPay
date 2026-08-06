/**
 * In-app cron scheduler.
 *
 * WHY: GitHub Actions scheduled workflows are heavily throttled for this repo
 * (observed: every-5-minute schedules firing every 1.5–2 hours, some never).
 * Production runs on Railway as a persistent Node server, so time-sensitive
 * jobs run here as plain interval timers started from `src/instrumentation.ts`
 * at server boot. The GitHub Actions workflows remain in place as a redundant
 * backup layer — every job wired here is concurrency-safe, so an occasional
 * double trigger is harmless.
 *
 * Jobs:
 *   - ghl-inbound-sync  every 60s   inbound SMS poll for PIT-connected venues
 *   - ai-send           every 10min AI Concierge follow-up SMS dispatch
 *
 * Guarantees:
 *   - Overlap guard: a tick is skipped when the previous run of that job is
 *     still in flight (simple per-job in-flight flag).
 *   - Heartbeat: one log line per run (job, duration, items) so Railway logs
 *     show the scheduler is alive.
 *   - Failures are recorded to the admin Error Log via logError() in addition
 *     to the console.
 *
 * Env switches:
 *   - DISABLE_IN_APP_CRON=1   turn the whole scheduler off (prod escape hatch)
 *   - ENABLE_IN_APP_CRON=1    opt-in outside production (off by default in dev
 *                             so `next dev` never fires jobs against real data)
 *   - IN_APP_CRON_JOBS=a,b    optional allowlist of job names (testing aid)
 */

import { logError } from '@/lib/error-log';

interface ScheduledJob {
  name: string;
  intervalMs: number;
  /** Delay before the first run so a booting/restarting deploy isn't slammed. */
  initialDelayMs: number;
  /** Returns a short human-readable summary of items processed. */
  run: () => Promise<string>;
}

const JOBS: ScheduledJob[] = [
  {
    name: 'ghl-inbound-sync',
    intervalMs: 60 * 1000,
    initialDelayMs: 20 * 1000,
    run: async () => {
      const { runGhlInboundSyncCron } = await import('@/lib/ghl-inbound-sync-cron');
      // Light per-run scope: this now ticks every 60s (vs every 5min on GitHub
      // Actions), so each run scans fewer, more recent threads.
      const r = await runGhlInboundSyncCron({ maxThreads: 25, activeDays: 7, backfillLimit: 10 });
      return `venues=${r.venuesConsidered} threads=${r.threadsScanned} imported=${r.messagesImported} backfilled=${r.contactIdsBackfilled}`;
    },
  },
  {
    name: 'ai-send',
    intervalMs: 10 * 60 * 1000,
    initialDelayMs: 90 * 1000,
    run: async () => {
      const { runAiSendCron } = await import('@/lib/ai-concierge/send-cron');
      // Safe to double-trigger (GitHub Actions backup may also hit the
      // endpoint): runAiSendCron atomically reserves leads by bumping
      // ai_next_send_at, so concurrent runs claim disjoint sets.
      const r = await runAiSendCron();
      if (r.killSwitchEngaged) return 'kill-switch engaged; skipped';
      return `scanned=${r.scanned} sent=${r.sent} expired=${r.expired} retried=${r.retried} optedOut=${r.optedOut} errors=${r.errors.length}`;
    },
  },
];

const inFlight = new Set<string>();

async function tick(job: ScheduledJob): Promise<void> {
  if (inFlight.has(job.name)) {
    console.log(`[in-app-cron] job=${job.name} skipped=overlap (previous run still in flight)`);
    return;
  }
  inFlight.add(job.name);
  const startedAt = Date.now();
  try {
    const summary = await job.run();
    console.log(`[in-app-cron] job=${job.name} ok duration_ms=${Date.now() - startedAt} ${summary}`);
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    console.error(`[in-app-cron] job=${job.name} FAILED duration_ms=${durationMs}`, e);
    void logError({
      level: 'error',
      source: 'cron',
      category: `in_app_cron:${job.name}`,
      message: `In-app scheduled job "${job.name}" failed`,
      error: e,
      context: { durationMs, intervalMs: job.intervalMs },
    });
  } finally {
    inFlight.delete(job.name);
  }
}

/** Idempotent per process — instrumentation's register() can in principle be
 *  evaluated more than once (e.g. dev HMR), so guard on globalThis. */
const STARTED_FLAG = Symbol.for('storypay.inAppSchedulerStarted');

export function startInAppScheduler(): void {
  const g = globalThis as { [STARTED_FLAG]?: boolean };
  if (g[STARTED_FLAG]) return;

  if (process.env.DISABLE_IN_APP_CRON === '1') {
    console.log('[in-app-cron] disabled via DISABLE_IN_APP_CRON');
    return;
  }
  if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_IN_APP_CRON !== '1') {
    console.log('[in-app-cron] not production and ENABLE_IN_APP_CRON not set — scheduler off');
    return;
  }

  const allowlist = (process.env.IN_APP_CRON_JOBS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const jobs = allowlist.length > 0 ? JOBS.filter((j) => allowlist.includes(j.name)) : JOBS;

  g[STARTED_FLAG] = true;

  for (const job of jobs) {
    const initial = setTimeout(() => {
      void tick(job);
      const interval = setInterval(() => void tick(job), job.intervalMs);
      interval.unref?.();
    }, job.initialDelayMs);
    initial.unref?.();
    console.log(
      `[in-app-cron] scheduled job=${job.name} interval_ms=${job.intervalMs} first_run_in_ms=${job.initialDelayMs}`
    );
  }
}
