'use client';

/**
 * ListingTracker (homepage app)
 *
 * Fires analytics events for the public listing page at storyvenue.com.
 * Events are POSTed cross-origin to the main app's /api/listing-track endpoint
 * (app.storyvenue.com), which persists them into the `listing_events` table.
 *
 * Tracks: page_view, session_heartbeat (every 30s), scroll_25/50/75/100,
 *         photo_view, faq_open, map_click, social_click.
 */

import { useEffect, useRef } from 'react';

const API_BASE =
  process.env.NEXT_PUBLIC_DASHBOARD_URL?.replace(/\/$/, '') ||
  'https://app.storyvenue.com';

const TRACK_URL = `${API_BASE}/api/listing-track`;

interface Props {
  venueId: string;
}

function getOrCreateSessionId(venueId: string): string {
  const key = `lsid_${venueId}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function getUtmParams(): { utm_source?: string; utm_medium?: string; utm_campaign?: string } {
  try {
    const p = new URLSearchParams(window.location.search);
    return {
      utm_source: p.get('utm_source') ?? undefined,
      utm_medium: p.get('utm_medium') ?? undefined,
      utm_campaign: p.get('utm_campaign') ?? undefined,
    };
  } catch {
    return {};
  }
}

export function ListingTracker({ venueId }: Props) {
  const sessionId = useRef<string | null>(null);
  const scrollFired = useRef({ s25: false, s50: false, s75: false, s100: false });
  const firedPageView = useRef(false);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);

  function track(event_type: string, event_data: Record<string, unknown> = {}) {
    if (!sessionId.current) return;
    const payload = {
      venue_id: venueId,
      session_id: sessionId.current,
      event_type,
      event_data,
      referrer: document.referrer || null,
      ...getUtmParams(),
    };
    fetch(TRACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      mode: 'cors',
    }).then(res => {
      if (!res.ok) console.error('[ListingTracker]', event_type, res.status);
    }).catch(err => {
      console.error('[ListingTracker]', event_type, err);
    });
  }

  useEffect(() => {
    sessionId.current = getOrCreateSessionId(venueId);
    console.log(`[ListingTracker] venue=${venueId} url=${TRACK_URL}`);

    if (!firedPageView.current) {
      firedPageView.current = true;
      track('page_view');
    }

    // Heartbeat — powers "On listing right now" counter. Fires immediately
    // so the visitor appears in realtime, then every 30s while the tab is open.
    track('session_heartbeat');
    heartbeat.current = setInterval(() => track('session_heartbeat'), 30_000);

    function onScroll() {
      const scrolled = window.scrollY + window.innerHeight;
      const total = document.documentElement.scrollHeight;
      const pct = (scrolled / total) * 100;
      if (!scrollFired.current.s25 && pct >= 25) { scrollFired.current.s25 = true; track('scroll_25'); }
      if (!scrollFired.current.s50 && pct >= 50) { scrollFired.current.s50 = true; track('scroll_50'); }
      if (!scrollFired.current.s75 && pct >= 75) { scrollFired.current.s75 = true; track('scroll_75'); }
      if (!scrollFired.current.s100 && pct >= 95) { scrollFired.current.s100 = true; track('scroll_100'); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest('[data-track]') as HTMLElement | null;
      if (!el) return;
      const type = el.dataset.track!;
      const extra: Record<string, unknown> = {};
      if (el.dataset.trackIndex) extra.photo_index = Number(el.dataset.trackIndex);
      if (el.dataset.trackPlatform) extra.platform = el.dataset.trackPlatform;
      if (el.dataset.trackFaq) extra.faq_index = Number(el.dataset.trackFaq);
      track(type, extra);
    }
    document.addEventListener('click', onClick);

    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('click', onClick);
      if (heartbeat.current) clearInterval(heartbeat.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  return null;
}
