'use client';

/**
 * Global client-side error capture. Mounted once in the root layout so it
 * covers EVERY surface — sub-account (venue) dashboard pages, the couple
 * portal, and public lead-facing forms (e.g. the pricing-guide form).
 *
 * Captures four classes of client problem and ships them to /api/log-error
 * (which attributes them to the venue via the session cookie):
 *   1. Uncaught runtime errors        — window 'error'
 *   2. Unhandled promise rejections   — window 'unhandledrejection'
 *   3. Failed same-origin API calls   — patched fetch (5xx / network)
 *   4. React render crashes           — reported by the error.tsx boundaries
 *      via the exported reportClientError() helper.
 *
 * Safeguards so it never becomes noise or a feedback loop:
 *   - Client-side dedup + throttle (same fingerprint at most once / 30s).
 *   - Hard cap on total reports per page load.
 *   - Ignores its own endpoint and cross-origin/3rd-party script noise.
 *   - Uses sendBeacon so reports survive navigation/unload.
 */

import { useEffect } from 'react';

const ENDPOINT = '/api/log-error';
const recent = new Map<string, number>();
const DEDUP_MS = 30_000;
let sentThisLoad = 0;
const MAX_PER_LOAD = 40;

function fingerprint(parts: (string | number | undefined | null)[]): string {
  return parts.filter(Boolean).join('|').slice(0, 300);
}

interface ClientErrorReport {
  message: string;
  stack?: string;
  source?: string;
  category?: string;
  level?: 'info' | 'warning' | 'error' | 'critical';
  route?: string;
  httpStatus?: number;
  context?: Record<string, unknown>;
}

/** Fire-and-forget report. Safe to call from anywhere on the client. */
export function reportClientError(report: ClientErrorReport): void {
  try {
    if (typeof window === 'undefined') return;
    if (!report.message) return;
    if (sentThisLoad >= MAX_PER_LOAD) return;

    const fp = fingerprint([report.category, report.message, report.route, report.httpStatus]);
    const now = Date.now();
    const last = recent.get(fp);
    if (last && now - last < DEDUP_MS) return;
    recent.set(fp, now);
    sentThisLoad += 1;

    const payload = JSON.stringify({
      level: report.level ?? 'error',
      source: 'client',
      category: report.category ?? 'browser',
      message: report.message.slice(0, 2000),
      stack: report.stack?.slice(0, 8000),
      route: report.route ?? window.location.pathname + window.location.search,
      httpStatus: report.httpStatus,
      context: {
        ...report.context,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        href: window.location.href,
      },
    });

    // sendBeacon survives page unload; fall back to keepalive fetch.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
    } else {
      void fetch(ENDPOINT, { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch { /* the logger must never throw */ }
}

// Some noise we never want to log (browser extensions, 3rd-party scripts).
const IGNORE = [
  /ResizeObserver loop/i,
  /Script error\.?$/i,            // cross-origin script with no detail
  /Non-Error promise rejection/i,
  /fbq|facebook|fbevents/i,
  /chrome-extension|moz-extension/i,
];
function shouldIgnore(msg: string): boolean {
  return IGNORE.some((re) => re.test(msg));
}

/**
 * After a deploy, a tab that was already open asks for code files that no
 * longer exist. Reload once so the visitor gets the new version instead of a
 * broken page; the timestamp guard stops a reload loop if it keeps failing.
 */
const STALE_CHUNK = /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to load chunk|Importing a module script failed|error loading dynamically imported module/i;
const RELOAD_KEY = 'sv-chunk-reload-at';
function recoverFromStaleChunk(msg: string): boolean {
  if (!STALE_CHUNK.test(msg)) return false;
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return false; // already tried: let it be reported
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false; // no storage means no loop guard, so don't auto-reload
  }
  window.location.reload();
  return true;
}

/** Background polls (badges, live counters) fail harmlessly when a tab sleeps or the network blips. */
const BACKGROUND_POLL = /\/(unread-count|unread|badge-count|inbox-count|realtime|lead-funnel)$/;

export default function ClientErrorLogger() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const msg = e.message || 'Uncaught error';
      if (shouldIgnore(msg) || (e.filename && /extension:\/\//.test(e.filename))) return;
      if (recoverFromStaleChunk(msg)) return;
      reportClientError({
        category: 'window_error',
        message: msg,
        stack: e.error instanceof Error ? e.error.stack : (e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined),
      });
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const msg = reason instanceof Error ? reason.message
        : typeof reason === 'string' ? reason
        : (() => { try { return JSON.stringify(reason); } catch { return 'Unhandled promise rejection'; } })();
      if (shouldIgnore(msg)) return;
      if (recoverFromStaleChunk(msg || '')) return;
      reportClientError({
        category: 'unhandled_rejection',
        message: msg || 'Unhandled promise rejection',
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    // Patch fetch to capture failed same-origin API calls (a common cause of
    // "the button doesn't work" — the click fires a request that fails).
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let url = '';
      try { url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url; } catch { /* ignore */ }
      const method = (init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
      const isApi = url.startsWith('/api/') || url.includes(`${window.location.origin}/api/`);
      const isSelf = url.includes('/api/log-error');

      try {
        const res = await originalFetch(input, init);
        // Log server failures on our own API only (4xx as warning, 5xx as error),
        // but skip *expected* auth/validation outcomes (wrong password, duplicate
        // email, not-signed-in admin polls). Those are normal user input — not
        // platform bugs — and would otherwise flood the error log with noise.
        if (isApi && !isSelf && res.status >= 400 && !isExpectedApiFailure(cleanPath(url), res.status)) {
          let detail = '';
          try { detail = (await res.clone().text()).slice(0, 300); } catch { /* ignore */ }
          reportClientError({
            level: res.status >= 500 ? 'error' : 'warning',
            category: 'api_fetch',
            httpStatus: res.status,
            route: cleanPath(url),
            message: `${method} ${cleanPath(url)} → ${res.status}`,
            context: { method, responseSnippet: detail || undefined },
          });
        }
        return res;
      } catch (err) {
        // Network-level failure (offline, CORS, aborted, DNS). Only log our API
        // calls so we don't capture every 3rd-party beacon that gets blocked,
        // and skip cancelled requests and background badge polls.
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        const backgroundPoll = method === 'GET' && BACKGROUND_POLL.test(cleanPath(url));
        if (isApi && !isSelf && !aborted && !backgroundPoll) {
          reportClientError({
            level: 'error',
            category: 'api_network',
            route: cleanPath(url),
            message: `${method} ${cleanPath(url)} network failure: ${err instanceof Error ? err.message : 'fetch failed'}`,
            context: { method },
          });
        }
        throw err;
      }
    };

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}

/**
 * True for HTTP failures that are *expected* by design and therefore not worth
 * logging as platform errors:
 *
 *   - 401 / 403 anywhere — "not signed in" / "not allowed". This is normal auth
 *     state (e.g. a wrong password on sign-in, or admin dashboard polls that
 *     fire before a session exists), not a bug.
 *   - 400 / 409 / 422 / 429 on auth & credential endpoints — normal user-facing
 *     validation (missing field, duplicate email, weak password, rate limit).
 */
const AUTH_PATHS = /^\/api\/(auth\b|admin\/login\b|admin\/auth\b)/;
function isExpectedApiFailure(path: string, status: number): boolean {
  if (status === 401 || status === 403) return true;
  if (AUTH_PATHS.test(path) && (status === 400 || status === 409 || status === 422 || status === 429)) {
    return true;
  }
  return false;
}

/** Strip origin + query so routes group cleanly in the error log. */
function cleanPath(url: string): string {
  try {
    if (url.startsWith('/')) return url.split('?')[0];
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0];
  }
}
