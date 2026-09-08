'use client';

/**
 * LeadLinkTracker (homepage app)
 *
 * Fires analytics for the public Lead Link (link-in-bio) page at
 * storyvenue.com/venue/{slug}/links. Kept deliberately separate from the
 * listing ListingTracker so lead-link traffic never inflates listing view /
 * funnel metrics.
 *
 * Events (POSTed cross-origin to app.storyvenue.com/api/listing-track):
 *   - lead_link_view         once on mount (a visit from a social bio)
 *   - lead_link_click        card taps  (event_data.platform = listing | pricing)
 *   - lead_link_social_click social taps (event_data.platform = instagram | …)
 *
 * Buttons opt in by setting data-track / data-track-platform attributes.
 */

import { useEffect, useRef } from 'react';

const API_BASE =
  process.env.NEXT_PUBLIC_DASHBOARD_URL?.replace(/\/$/, '') ||
  'https://app.storyvenue.com';

const TRACK_URL = `${API_BASE}/api/listing-track`;

const LEAD_LINK_EVENTS = new Set(['lead_link_click', 'lead_link_social_click']);

function getOrCreateSessionId(venueId: string): string {
  const key = `llsid_${venueId}`;
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

export function LeadLinkTracker({ venueId }: { venueId: string }) {
  const sessionId = useRef<string | null>(null);
  const firedView = useRef(false);

  useEffect(() => {
    sessionId.current = getOrCreateSessionId(venueId);

    function track(event_type: string, event_data: Record<string, unknown> = {}) {
      if (!sessionId.current) return;
      fetch(TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venueId,
          session_id: sessionId.current,
          event_type,
          event_data,
          referrer: document.referrer || null,
          ...getUtmParams(),
        }),
        keepalive: true,
        mode: 'cors',
      }).catch(() => {});
    }

    if (!firedView.current) {
      firedView.current = true;
      track('lead_link_view');
    }

    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest('[data-track]') as HTMLElement | null;
      if (!el) return;
      const type = el.dataset.track!;
      if (!LEAD_LINK_EVENTS.has(type)) return;
      track(type, el.dataset.trackPlatform ? { platform: el.dataset.trackPlatform } : {});
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [venueId]);

  return null;
}
