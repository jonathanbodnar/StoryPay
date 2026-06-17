'use client';

/**
 * Client-side analytics helper.
 *
 * Fires a curated set of named UI events (interest signals, frustration
 * signals, funnel intents) to the same ingest endpoint the UsageTracker uses.
 * The server resolves which venue/user the event belongs to from the session
 * cookie — the client only sends the behavioral payload.
 *
 * Best-effort and non-blocking: failures are swallowed so tracking can never
 * disrupt the UI. Only events in CLIENT_EVENTS (see the ingest route) are
 * persisted; anything else is dropped server-side.
 */

const ENDPOINT = '/api/analytics/track';

function sessionId(): string | undefined {
  try {
    return sessionStorage.getItem('sp.analytics.sid') ?? undefined;
  } catch {
    return undefined;
  }
}

export function trackClient(
  event: string,
  opts: { label?: string; properties?: Record<string, unknown> } = {},
): void {
  try {
    const payload = JSON.stringify({
      events: [{
        event,
        path: typeof window !== 'undefined' ? window.location.pathname : undefined,
        label: opts.label,
        sessionId: sessionId(),
        properties: opts.properties,
      }],
    });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
    } else {
      void fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => { /* silent */ });
    }
  } catch { /* silent */ }
}
