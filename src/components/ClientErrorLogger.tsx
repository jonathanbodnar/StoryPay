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

export default function ClientErrorLogger() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const msg = e.message || 'Uncaught error';
      if (shouldIgnore(msg) || (e.filename && /extension:\/\//.test(e.filename))) return;
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
        // Log server failures on our own API only (4xx as warning, 5xx as error).
        if (isApi && !isSelf && res.status >= 400) {
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
        // calls so we don't capture every 3rd-party beacon that gets blocked.
        if (isApi && !isSelf) {
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

/** Strip origin + query so routes group cleanly in the error log. */
function cleanPath(url: string): string {
  try {
    if (url.startsWith('/')) return url.split('?')[0];
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0];
  }
}
