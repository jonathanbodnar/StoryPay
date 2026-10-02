/**
 * Next.js server-startup hook (instrumentation.ts).
 *
 * register() runs once when a Next.js server instance boots. We use it to
 * start the in-app cron scheduler on the persistent Railway Node server —
 * GitHub Actions scheduled workflows proved too throttled/unreliable for
 * time-sensitive jobs (inbound SMS sync, AI Concierge sends).
 *
 * Guards:
 *   - NEXT_RUNTIME check: only the Node.js server runtime (never edge). Node-only
 *     code is imported inside that branch so the edge build never compiles it.
 *   - NEXT_PHASE check: never during `next build`.
 *   - startInAppScheduler() is itself idempotent per process.
 *
 * The test copy (APP_ENV=staging) refuses to start with live settings and
 * blocks requests to live systems (src/lib/staging.ts).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { prepareStaging } = await import('@/lib/staging-startup');
    prepareStaging();

    // Venue sessions can't be verified without a signing secret; the proxy
    // then treats everyone as signed out. Make that impossible to miss.
    if (process.env.NODE_ENV === 'production' && !(process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || process.env.ADMIN_SECRET || process.env.LEAD_WEBHOOK_SECRET)) {
      console.error('[startup] CRITICAL: no session signing secret (SESSION_SECRET). Venue sign-in is off until it is set.');
      const { logError } = await import('@/lib/error-log');
      void logError({ level: 'critical', source: 'api', category: 'startup', message: 'No session signing secret: venue sign-in is off until SESSION_SECRET is set' });
    }

    const { startInAppScheduler } = await import('@/lib/in-app-scheduler');
    startInAppScheduler();
  }
}
