/**
 * In-app cron scheduler.
 *
 * WHY: GitHub Actions scheduled workflows are heavily throttled for this repo
 * (observed: every-5-minute schedules firing every 1.5–2 hours, some never).
 * Production runs on Railway as a persistent Node server, so time-sensitive
 * jobs run here as plain interval timers started from `src/instrumentation.ts`
 * at server boot. Every job wired here is concurrency-safe, so an occasional
 * double trigger (a manual run, or two servers overlapping during a deploy) is
 * harmless. The GitHub Actions timers were removed on Oct 2, 2026; the jobs
 * not listed here run from Railway's cron services (Marketing Cron: marketing
 * email, appointment reminders and the re-engagement drip; Contacts Cron: GHL
 * contact sync; AI Concierge Cron: ai-send and ai-activate).
 *
 * Jobs:
 *   - ghl-inbound-sync-hot  every 7s   inbound SMS poll for HOT threads only
 *                                      (SMS activity within the last hour) so
 *                                      active conversations feel instant
 *   - ghl-inbound-sync      every 60s  baseline sweep for threads active in
 *                                      the last 14 days, in rotation (excludes
 *                                      what the hot tier covers)
 *   - ghl-cold-sweep        every 15m  dormant threads (last activity 14–90d
 *                                      ago) that aged out of the tiers above;
 *                                      round-robin, budget-capped so a fresh
 *                                      reply on a long-quiet thread is still
 *                                      discovered promptly (see cold sweep in
 *                                      ghl-inbound-sync-cron.ts)
 *   - concierge-sms-sync    every 20s  inbound SMS replies to venue owner/
 *                                      team members from Private Clients /
 *                                      venue-contact-card direct messages
 *                                      (separate from the bride/lead thread
 *                                      model above — see concierge-sms-sync.ts)
 *   - ai-send               every 10m  AI Concierge follow-up SMS dispatch
 *   - free-downgrades       every 10m  venues that cancelled move to Free at
 *                                      the end of the term they paid for
 *                                      (see trial-sweep.ts)
 *   - no-card-trials        every 30m  trial emails for venues without a card,
 *                                      then Free after a 7-day grace period
 *   - owner-ghl-stage-sync  every 30m  keeps the platform owner's "SaaS
 *                                      Clients" GHL pipeline in sync with
 *                                      every venue's trial/paid/canceled
 *                                      lifecycle (see owner-ghl-sync.ts).
 *                                      Cheap steady-state: venues already in
 *                                      sync cost zero GHL calls per run.
 *   - installments          every 60m  payment-plan charges, 3-day heads-ups,
 *                                      Stripe accounts in review (see
 *                                      stripe/installments-cron.ts)
 *   - payment-reminders     daily 9:00 UTC   overdue-payment reminder emails
 *   - private-client-reminder daily 17:00 UTC  Private Client monthly email
 *   - tag-sweep             daily 3:00 UTC   date/activity system tags
 *                                      Each claims its work first, so a
 *                                      manual run can't double-send, and a
 *                                      daily job claims its day in
 *                                      admin_kv_cache (one run per day).
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
import { isStaging } from '@/lib/staging';

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

/** Last observed hot-thread count, so we log transitions (0→N, N→0) instead
 *  of every 7s scan — visible "locked on / released" evidence w/o flooding. */
let lastHotCount = 0;

/**
 * Claim today's run of a daily job in admin_kv_cache, so a restart or a
 * second server (deploys overlap briefly) doesn't run it again the same day.
 */
async function claimDay(job: string, day: string): Promise<boolean> {
  const { supabaseAdmin } = await import('@/lib/supabase');
  const key = `cron-day:${job}`;
  const { data, error } = await supabaseAdmin.from('admin_kv_cache').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(`[in-app-cron] could not read ${key}: ${error.message}`);
  const last = (data?.value as { day?: string } | null)?.day ?? null;
  if (last === day) return false;
  if (!data) {
    const { error: insertError } = await supabaseAdmin.from('admin_kv_cache').insert({ key, value: { day } });
    return !insertError; // a duplicate key means another server claimed it first
  }
  let update = supabaseAdmin
    .from('admin_kv_cache')
    .update({ value: { day }, updated_at: new Date().toISOString() })
    .eq('key', key);
  update = last === null ? update.is('value->>day', null) : update.eq('value->>day', last);
  const { data: claimed } = await update.select('key');
  return !!claimed?.length;
}

/** Run once a UTC day, on the first tick at or after `hour`:00 UTC. */
export function onceDailyAfter(hour: number, job: string, run: () => Promise<string | null>): () => Promise<string | null> {
  let doneDay = '';
  return async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() < hour || doneDay === day) return null;
    const claimed = await claimDay(job, day);
    doneDay = day; // claimed here, or already run elsewhere today
    return claimed ? run() : null;
  };
}

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
      const hotCountChanged = r.hotThreads !== lastHotCount;
      lastHotCount = r.hotThreads;
      // Always log imports; log when the hot set changes size (a thread just
      // became hot or aged out); stay quiet on steady-state scans — a plain
      // "polled N hot threads, nothing new" every 7s would flood the logs.
      if (r.messagesImported > 0) {
        return `hot=${r.hotThreads} threads=${r.threadsScanned} imported=${r.messagesImported}`;
      }
      if (hotCountChanged) {
        return `hot-set-changed hot=${r.hotThreads} threads=${r.threadsScanned} imported=0`;
      }
      return null;
    },
  },
  {
    name: 'ghl-inbound-sync',
    intervalMs: 60 * 1000,
    initialDelayMs: 20 * 1000,
    run: async () => {
      const { runGhlInboundSyncCron } = await import('@/lib/ghl-inbound-sync-cron');
      // Light per-run scope: this ticks every 60s. Threads the hot tier already
      // polls every 7s are excluded; each run checks the newest few of the
      // rest plus the next slice in rotation, so every thread active in the
      // last 14 days is checked every few minutes (the cold sweep takes over
      // at 14 days; this used to stop at 7, leaving 7–14 days unchecked).
      const r = await runGhlInboundSyncCron({
        maxThreads: 25,
        activeDays: 14,
        backfillLimit: 10,
        excludeHotTier: { windowMinutes: HOT_WINDOW_MINUTES, cap: HOT_MAX_THREADS },
      });
      return `venues=${r.venuesConsidered} threads=${r.threadsScanned} imported=${r.messagesImported} backfilled=${r.contactIdsBackfilled}`;
    },
  },
  {
    // Cold tier: dormant threads (last activity 14–90d ago) that have aged out
    // of the hot + baseline tiers. Round-robin by the cold_swept_at watermark
    // and capped per run (default 40 threads / 10 per venue), so GHL call volume
    // stays flat regardless of account size. A 15m cadence keeps a small cold
    // set revisited well inside the 60m "new reply" alert window, so a genuinely
    // fresh reply on a long-quiet thread still notifies; larger backlogs simply
    // take a few cycles to fully cover. All GHL-connected (PIT + OAuth) venues.
    name: 'ghl-cold-sweep',
    intervalMs: 15 * 60 * 1000,
    initialDelayMs: 2 * 60 * 1000,
    run: async () => {
      const { runGhlColdThreadSync } = await import('@/lib/ghl-inbound-sync-cron');
      const r = await runGhlColdThreadSync();
      if (r.messagesImported > 0) {
        return `candidates=${r.coldCandidates} threads=${r.threadsScanned} imported=${r.messagesImported}`;
      }
      if (r.threadsScanned > 0) {
        return `candidates=${r.coldCandidates} threads=${r.threadsScanned} imported=0`;
      }
      return null;
    },
  },
  {
    // Small, bounded contact set (only owners/team members the concierge
    // team has actually texted), so a lighter cadence than the bride
    // hot-tier is plenty while staying well clear of GHL rate limits.
    name: 'concierge-sms-sync',
    intervalMs: 20 * 1000,
    initialDelayMs: 15 * 1000,
    run: async () => {
      const { runConciergeSmsReplySync } = await import('@/lib/concierge-sms-sync');
      const r = await runConciergeSmsReplySync();
      if (r.messagesImported > 0) {
        return `contacts=${r.contactsChecked} imported=${r.messagesImported}`;
      }
      return null;
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
  {
    // A venue that cancels keeps its plan until the end of the term it paid
    // for, then moves to Free (lib/trial-sweep.ts). A few minutes late is fine.
    name: 'free-downgrades',
    intervalMs: 10 * 60 * 1000,
    initialDelayMs: 2 * 60 * 1000,
    run: async () => {
      const { applyDueFreeDowngrades } = await import('@/lib/trial-sweep');
      const r = await applyDueFreeDowngrades();
      return r.applied > 0 || r.errors > 0 ? `applied=${r.applied} errors=${r.errors}` : null;
    },
  },
  {
    // Trials that end without a card: a heads-up 3 days out, one notice on the
    // end date, then Free after a 7-day grace period (lib/trial-sweep.ts).
    name: 'no-card-trials',
    intervalMs: 30 * 60 * 1000,
    initialDelayMs: 3 * 60 * 1000,
    run: async () => {
      const { processNoCardTrials } = await import('@/lib/trial-sweep');
      const r = await processNoCardTrials();
      const total = r.reminded + r.endedNotices + r.movedToFree + r.errors;
      return total > 0
        ? `reminded=${r.reminded} ended_notices=${r.endedNotices} moved_to_free=${r.movedToFree} errors=${r.errors}`
        : null;
    },
  },
  {
    // Not urgent — trial/paid/cancel transitions moving a CRM opportunity a
    // few minutes late is a non-issue, so a light 30m cadence keeps this off
    // GHL's rate limits entirely. No-op (zero GHL calls) if OWNER_GHL_* env
    // vars aren't set, or if nothing has changed since the last run.
    name: 'owner-ghl-stage-sync',
    intervalMs: 30 * 60 * 1000,
    initialDelayMs: 45 * 1000,
    run: async () => {
      const { reconcileOwnerGhlStages } = await import('@/lib/owner-ghl-sync');
      const r = await reconcileOwnerGhlStages();
      if (r.totalEligible === 0) return null; // not configured
      if (r.synced > 0 || r.failed > 0) {
        return `eligible=${r.totalEligible} in_sync=${r.alreadyInSync} synced=${r.synced} failed=${r.failed}`;
      }
      return null;
    },
  },
  {
    // Payment plans: each due payment is claimed before it's charged, so this
    // and a manual run of /api/cron/installments can never charge it twice.
    name: 'installments',
    intervalMs: 60 * 60 * 1000,
    initialDelayMs: 5 * 60 * 1000,
    run: async () => {
      const { isStripeConfigured } = await import('@/lib/stripe/client');
      if (!isStripeConfigured()) return null;
      const { runInstallmentsCron } = await import('@/lib/stripe/installments-cron');
      const r = await runInstallmentsCron();
      const i = r.installments;
      const headsUps = r.headsUps?.sent ?? 0;
      return i.charged + i.processing + i.failed + headsUps + r.accountsSynced > 0
        ? `charged=${i.charged} processing=${i.processing} failed=${i.failed} skipped=${i.skipped} heads_ups=${headsUps} accounts_synced=${r.accountsSynced}`
        : null;
    },
  },
  {
    // Overdue-payment reminders, at the same time of day as before.
    name: 'payment-reminders',
    intervalMs: 10 * 60 * 1000,
    initialDelayMs: 4 * 60 * 1000,
    run: onceDailyAfter(9, 'payment-reminders', async () => {
      const { processPaymentRemindersCron } = await import('@/lib/payment-reminders');
      const r = await processPaymentRemindersCron();
      return `processed=${r.processed} sent=${r.sent} errors=${r.errors}`;
    }),
  },
  {
    // The Private Client monthly email goes out on the first run after its
    // date, so the daily hour keeps it mid-day in the US.
    name: 'private-client-reminder',
    intervalMs: 10 * 60 * 1000,
    initialDelayMs: 6 * 60 * 1000,
    run: onceDailyAfter(17, 'private-client-reminder', async () => {
      const { processPrivateClientMonthlyReminder } = await import('@/lib/private-client-monthly-reminder');
      const r = await processPrivateClientMonthlyReminder();
      return `processed=${r.processed} sent=${r.sent} seeded=${r.seeded} skipped=${r.skipped} errors=${r.errors}`;
    }),
  },
  {
    name: 'tag-sweep',
    intervalMs: 10 * 60 * 1000,
    initialDelayMs: 8 * 60 * 1000,
    run: onceDailyAfter(3, 'tag-sweep', async () => {
      const { runTagSweep } = await import('@/lib/tag-sweep');
      const c = await runTagSweep();
      return Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ');
    }),
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
  if (isStaging() && process.env.ENABLE_IN_APP_CRON !== '1') {
    console.log('[in-app-cron] test copy and ENABLE_IN_APP_CRON not set — scheduler off');
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
