'use client';

/**
 * Keeps the native app icon badge (the red number, same as any other app)
 * in sync with the total "needs attention" count — new leads + unread
 * messages + AI Concierge handoffs, i.e. everything NativePushRegistrar can
 * send a push for. No-op on the web.
 *
 * Two things drive the badge, matching how iOS/Android actually work:
 *   1. Every native push already carries `apns.payload.aps.badge` set to the
 *      fresh total at SEND time (see src/lib/native-push.ts) — this is what
 *      updates the badge while the app is backgrounded or killed, before
 *      this component ever runs again.
 *   2. This component keeps it correct the rest of the time: right after
 *      launch, whenever the tab regains focus, whenever one of the existing
 *      unread-count events fires (new lead / new message / concierge reply —
 *      the same events Sidebar.tsx and MobileTabBar.tsx already listen for),
 *      and right after a push is tapped/received in the foreground. That
 *      covers the case where the user reads something in-app and the badge
 *      needs to go DOWN without waiting on the next push.
 */

import { useEffect } from 'react';
import { isNativeApp } from '@/lib/platform';
import { LEADS_SEEN_KEY } from '@/lib/leads-badge';

async function fetchBadgeCount(): Promise<number | null> {
  let leadsSince: string | null = null;
  try { leadsSince = window.localStorage.getItem(LEADS_SEEN_KEY); } catch { /* ignore */ }
  const qs = leadsSince ? `?leadsSince=${encodeURIComponent(leadsSince)}` : '';
  try {
    const res = await fetch(`/api/notifications/badge-count${qs}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { count?: number };
    return typeof data.count === 'number' ? data.count : null;
  } catch {
    return null;
  }
}

export default function NativeBadgeSync() {
  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    let badgeMod: typeof import('@capawesome/capacitor-badge') | null = null;

    async function refresh() {
      const count = await fetchBadgeCount();
      if (cancelled || count === null) return;
      try {
        badgeMod ??= await import('@capawesome/capacitor-badge');
        await badgeMod.Badge.set({ count });
      } catch { /* badge plugin unavailable — never break the app over this */ }
    }

    void refresh();
    const interval = window.setInterval(refresh, 45_000);

    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);

    // Same events the sidebar/tab-bar badges already react to, so the app
    // icon updates the moment any of those pills would.
    const events = ['storypay:conversations-unread', 'storypay:leads-unread', 'storypay:concierge-unread'];
    const onEvt = () => void refresh();
    events.forEach((e) => window.addEventListener(e, onEvt));

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      events.forEach((e) => window.removeEventListener(e, onEvt));
    };
  }, []);

  return null;
}
