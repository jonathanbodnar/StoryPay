'use client';

/**
 * UsageTracker — global, lightweight behavioral tracker for the authenticated
 * dashboard. Mounted once inside DashboardShell so it covers every page.
 *
 * Captures two things automatically:
 *   1. Pageviews   — every client route change (path).
 *   2. Clicks      — clicks on meaningful UI (buttons, links, nav items, or any
 *                    element carrying a data-track="..." label), with a derived
 *                    human label so the admin panel can show "what people click".
 *
 * Events are queued and flushed in small batches (size- or time-based, plus on
 * page hide via sendBeacon) to /api/analytics/track. The server resolves which
 * venue/user the events belong to from the session cookie — the client only
 * sends the behavioral payload, never identity.
 *
 * Failures are silent by design: tracking must never disrupt the app.
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

interface QueuedEvent {
  event: 'pageview' | 'click' | 'rage_click' | 'session_start';
  path: string;
  label?: string;
  sessionId: string;
  properties?: Record<string, unknown>;
}

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_AT_COUNT = 8;
const ENDPOINT = '/api/analytics/track';

/** Stable per-tab session id (persists across route changes, resets per tab). */
function getSessionId(): string {
  try {
    const KEY = 'sp.analytics.sid';
    let sid = sessionStorage.getItem(KEY);
    if (!sid) {
      sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(KEY, sid);
    }
    return sid;
  } catch {
    return 'no-session';
  }
}

/** Derive a short, human-readable label for a clicked element. */
function labelFor(el: HTMLElement): { label: string; kind: string } | null {
  // Walk up to the nearest "interactive" ancestor we care about.
  const target = el.closest<HTMLElement>(
    '[data-track],button,a,[role="button"],[role="tab"],[role="menuitem"]',
  );
  if (!target) return null;

  const explicit = target.getAttribute('data-track');
  if (explicit) return { label: explicit.slice(0, 120), kind: 'tracked' };

  const aria = target.getAttribute('aria-label') || target.getAttribute('title');
  const tag = target.tagName.toLowerCase();
  const kind =
    tag === 'a' ? 'link'
    : target.getAttribute('role') || (tag === 'button' ? 'button' : tag);

  let text = aria || target.textContent || '';
  text = text.replace(/\s+/g, ' ').trim();
  if (!text && tag === 'a') text = (target as HTMLAnchorElement).getAttribute('href') || '';
  if (!text) return null;
  return { label: text.slice(0, 120), kind };
}

export default function UsageTracker() {
  const pathname = usePathname();
  const queue = useRef<QueuedEvent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flush the queue to the server (sendBeacon when leaving, fetch otherwise).
  const flush = (useBeacon = false) => {
    if (queue.current.length === 0) return;
    const events = queue.current.splice(0, queue.current.length);
    const payload = JSON.stringify({ events });
    try {
      if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
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
  };

  const enqueue = (e: QueuedEvent) => {
    queue.current.push(e);
    if (queue.current.length >= FLUSH_AT_COUNT) {
      flush();
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), FLUSH_INTERVAL_MS);
  };

  // Fire session_start once per browser tab session.
  useEffect(() => {
    try {
      const KEY = 'sp.analytics.started';
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1');
        enqueue({
          event: 'session_start',
          path: window.location.pathname,
          sessionId: getSessionId(),
          properties: document.referrer ? { referrer: document.referrer.slice(0, 200) } : undefined,
        });
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pageview on every route change.
  useEffect(() => {
    if (!pathname) return;
    enqueue({
      event: 'pageview',
      path: pathname,
      sessionId: getSessionId(),
      properties: typeof document !== 'undefined' && document.referrer
        ? { referrer: document.referrer.slice(0, 200) }
        : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Global click capture + flush-on-hide. Registered once.
  useEffect(() => {
    // Rage-click detector: 3+ clicks at ~the same spot within a short window.
    let lastX = 0, lastY = 0, burst = 0, lastT = 0, raged = false;

    const onClick = (ev: MouseEvent) => {
      const el = ev.target as HTMLElement | null;
      if (!el) return;

      // Frustration signal: rapid repeated clicks in the same area.
      const now = Date.now();
      const near = Math.abs(ev.clientX - lastX) < 24 && Math.abs(ev.clientY - lastY) < 24;
      if (near && now - lastT < 600) {
        burst += 1;
      } else {
        burst = 1; raged = false;
      }
      lastX = ev.clientX; lastY = ev.clientY; lastT = now;
      if (burst >= 3 && !raged) {
        raged = true;
        const ri = labelFor(el);
        enqueue({
          event: 'rage_click',
          path: window.location.pathname,
          label: ri?.label,
          sessionId: getSessionId(),
        });
      }

      const info = labelFor(el);
      if (!info) return;
      enqueue({
        event: 'click',
        path: window.location.pathname,
        label: info.label,
        sessionId: getSessionId(),
        properties: { kind: info.kind },
      });
    };

    const onHide = () => flush(true);

    document.addEventListener('click', onClick, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
    });
    window.addEventListener('pagehide', onHide);

    return () => {
      document.removeEventListener('click', onClick, { capture: true } as EventListenerOptions);
      window.removeEventListener('pagehide', onHide);
      if (timer.current) clearTimeout(timer.current);
      flush(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
