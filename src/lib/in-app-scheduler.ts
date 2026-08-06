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
 *   - ghl-inbound-sync-hot  every 7s   inbound SMS poll for HOT threads only
 *                                      (SMS activity within the last hour) so
 *                                      active conversations feel instant
 *   - ghl-inbound-sync      every 60s  baseline sweep for colder threads
 *                                      (excludes what the hot tier covers)
 *   - ai-send               every 10m  AI Concierge follow-up SMS dispatch
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
  /**
   * Returns a short human-readable summary of items processed, or null for an
   * uneventful tick that shouldn't be logged (high-frequency jobs only —
   * a 7s job logging every idle tick would flood Railway logs).
   */
  run: () => Promise<string | null>;
}

/** Hot-tier config, shared by the hot job and the baseline's exclusion. */
const HOT_WINDOW_MINUTES = 60;
const HOT_MAX_THREADS = 5;

const JOBS: ScheduledJob[] = [
  {
    // Hot tier: threads with SMS activity in the last hour get polled every
    // ~7s so active conversations feel instant. Idle ticks cost one indexed
    // DB select and zero GHL calls; typically 0-3 threads are hot.
    name: 'ghl-inbound-sync-hot',
    intervalMs: 7 * 1000,
    initialDelayMs: 10 * 1000,
    run: async () => {
      const { runGhlHotThreadSync } = await import('@/lib/ghl-inbound-sync-cron');
      const r = await runGhlHotThreadSync({
        windowMinutes: HOT_WINDOW_MINUTES,
        maxThreads: HOT_MAX_THREADS,
      });
      if (r.threadsScanned === 0) return null; // idle — stay quiet
      // Only worth a log line when something was actually imported; a plain
      // "polled N hot threads, nothing new" every 7s would still flood.
      if (r.messagesImported === 0) return null;
      return `hot=${r.hotThreads} threads=${r.threadsScanned} imported=${r.messagesImported}`;
    },
  },
  {
    name: 'ghl-inbound-sync',
    intervalMs: 60 * 1000,
    initialDelayMs: 20 * 1000,
    run: async () => {
      const { runGhlInboundSyncCron } = await import('@/lib/ghl-inbound-sync-cron');
      // Light per-run scope: this now ticks every 60s (vs every 5min on GitHub
      // Actions), so each run scans fewer, more recent threads. Threads the
      // hot tier already polls every 7s are excluded so the baseline budget
      // goes to colder threads (catching first inbound messages within ≤60s).
      const r = await runGhlInboundSyncCron({
        maxThreads: 25,
        activeDays: 7,
        backfillLimit: 10,
        excludeHotTier: { windowMinutes: HOT_WINDOW_MINUTES, cap: HOT_MAX_THREADS },
      });
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

/** Throttled log state so high-frequency jobs can't flood Railway logs. */
const idleTicks = new Map<string, number>();
const lastIdleLogAt = new Map<string, number>();
const lastOverlapLogAt = new Map<string, number>();
const IDLE_LOG_EVERY_MS = 5 * 60 * 1000;
const OVERLAP_LOG_EVERY_MS = 60 * 1000;

async function tick(job: ScheduledJob): Promise<void> {
  if (inFlight.has(job.name)) {
    // Skip rather than stack; log at most once per minute per job.
    const last = lastOverlapLogAt.get(job.name) ?? 0;
    if (Date.now() - last > OVERLAP_LOG_EVERY_MS) {
      lastOverlapLogAt.set(job.name, Date.now());
      console.log(`[in-app-cron] job=${job.name} skipped=overlap (previous run still in flight)`);
    }
    return;
  }
  inFlight.add(job.name);
  const startedAt = Date.now();
  try {
    const summary = await job.run();
    if (summary === null) {
      // Uneventful tick — aggregate into a periodic "alive" line instead.
      idleTicks.set(job.name, (idleTicks.get(job.name) ?? 0) + 1);
      const last = lastIdleLogAt.get(job.name) ?? 0;
      if (Date.now() - last > IDLE_LOG_EVERY_MS) {
        lastIdleLogAt.set(job.name, Date.now());
        console.log(`[in-app-cron] job=${job.name} alive idle_ticks_since_last_log=${idleTicks.get(job.name)}`);
        idleTicks.set(job.name, 0);
      }
      return;
    }
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
