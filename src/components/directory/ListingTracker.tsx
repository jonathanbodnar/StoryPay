'use client';

import { useEffect, useRef } from 'react';

interface Props {
  venueId: string;
  referrer?: string;
}

// Build the track URL at call-time from window.location.origin so it always
// hits the correct server regardless of NEXT_PUBLIC_APP_URL being set or not.
// The listing page and the API are in the same Next.js app, so the origin is
// always correct even when the site is accessed via multiple custom domains.
function getTrackUrl(): string {
  try {
    return `${window.location.origin}/api/listing-track`;
  } catch {
    return '/api/listing-track';
  }
}

function getOrCreateSessionId(venueId: string): string {
  const key = `lsid_${venueId}`;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  sessionStorage.setItem(key, id);
  return id;
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

export function ListingTracker({ venueId, referrer }: Props) {
  const sessionId = useRef<string | null>(null);
  const scrollFired = useRef({ s25: false, s50: false, s75: false, s100: false });
  const hasFiredPageView = useRef(false);
  const heartbeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  function track(event_type: string, event_data: Record<string, unknown> = {}) {
    if (!sessionId.current) return;
    const utms = getUtmParams();
    const payload = {
      venue_id: venueId,
      session_id: sessionId.current,
      event_type,
      event_data,
      referrer: referrer || document.referrer || null,
      ...utms,
    };
    const url = getTrackUrl();
    // Use fetch with keepalive:true — equivalent to sendBeacon but actually
    // surfaces errors to the console so we can diagnose failures.
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).then(res => {
      if (!res.ok) console.error('[ListingTracker] track failed', event_type, res.status, url);
    }).catch(err => {
      console.error('[ListingTracker] track error', event_type, url, err);
    });
  }

  useEffect(() => {
    sessionId.current = getOrCreateSessionId(venueId);

    // ── Page view ─────────────────────────────────────────────────────
    if (!hasFiredPageView.current) {
      hasFiredPageView.current = true;
      track('page_view');
    }

    // ── Scroll depth ──────────────────────────────────────────────────
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

    // ── Click delegation ──────────────────────────────────────────────
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
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

    // ── Heartbeat (every 30s) — powers the "Active right now" counter ────
    // Fire immediately so the visitor appears in realtime within seconds,
    // then repeat every 30s so they stay visible as long as the tab is open.
    track('session_heartbeat');
    heartbeatInterval.current = setInterval(() => track('session_heartbeat'), 30_000);

    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('click', onClick);
      if (heartbeatInterval.current) clearInterval(heartbeatInterval.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  return null;
}

// Convenience hook for contact form open/submit tracking (used in form components)
export function useListingTrackForm(venueId: string) {
  const sessionId = useRef<string | null>(null);

  useEffect(() => {
    try { sessionId.current = sessionStorage.getItem(`lsid_${venueId}`); } catch { /* noop */ }
  }, [venueId]);

  function postEvent(event_type: string) {
    if (!sessionId.current) return;
    const url = getTrackUrl();
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_id: venueId, session_id: sessionId.current, event_type, event_data: {} }),
      keepalive: true,
    }).catch(err => console.error('[ListingTracker]', event_type, err));
  }
  function trackFormOpen() { postEvent('contact_form_open'); }
  function trackFormSubmit() { postEvent('contact_form_submit'); }
  return { trackFormOpen, trackFormSubmit };
}
