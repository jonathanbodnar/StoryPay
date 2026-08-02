'use client';

import { useEffect } from 'react';
import { isNativeApp } from '@/lib/platform';
import { setClientCache, getClientCache } from '@/lib/client-cache';
import { resolveVenueTimezone } from '@/lib/venue-timezone';

type Pipeline = { id: string; is_default: boolean };

/**
 * Warms the client-side cache for the heavy tabs (Leads, Contacts, Calendar,
 * Conversations) shortly after the app opens, so tapping into them from Home
 * shows real data immediately instead of a spinner.
 *
 * Best-effort only: each target page still runs its own fetch on mount and
 * silently corrects anything here that's stale or slightly off (e.g. a
 * calendar month boundary computed before the venue's timezone loaded) — this
 * component only exists to make that correction invisible by pre-seeding the
 * cache a few seconds before the user gets there.
 *
 * Runs once per app session (guarded at module scope, not per-mount) and only
 * inside the native app shell, where tab-to-tab navigation is the norm.
 */
let hasPrefetched = false;

export default function NativeTabPrefetch() {
  useEffect(() => {
    if (!isNativeApp() || hasPrefetched) return;
    hasPrefetched = true;

    // Delay slightly so this never competes with the current page's own
    // critical-path fetches for bandwidth/priority.
    const timer = setTimeout(() => {
      void prefetchLeads();
      void prefetchContacts();
      void prefetchConversations();
      void prefetchCalendar();
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  return null;
}

async function prefetchLeads() {
  try {
    const pRes = await fetch('/api/pipelines', { cache: 'no-store' });
    if (!pRes.ok) return;
    const pData = await pRes.json();
    const pipelines: Pipeline[] = pData.pipelines ?? [];
    setClientCache('leads:pipelines', pipelines);
    if (pipelines.length === 0) return;

    const cachedPid = getClientCache<string>('leads:activePid');
    const pid =
      (cachedPid && pipelines.some((p) => p.id === cachedPid) && cachedPid) ||
      pipelines.find((p) => p.is_default)?.id ||
      pipelines[0]?.id;
    if (!pid) return;
    setClientCache('leads:activePid', pid);

    const lRes = await fetch(`/api/leads?pipeline_id=${encodeURIComponent(pid)}`, { cache: 'no-store' });
    if (!lRes.ok) return;
    const lData = await lRes.json();
    setClientCache(`leads:list:${pid}`, lData.leads ?? []);
  } catch {
    // Best-effort — the real page fetch is the source of truth.
  }
}

async function prefetchContacts() {
  try {
    const res = await fetch('/api/customers?search=&limit=1000&page=1&sort=az', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { data?: unknown[] };
    setClientCache('contacts:list', Array.isArray(data.data) ? data.data : []);
  } catch {
    // Best-effort.
  }
}

async function prefetchConversations() {
  try {
    const res = await fetch('/api/conversations/threads', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setClientCache('conv:threads', Array.isArray(data) ? data : []);
  } catch {
    // Best-effort.
  }
}

async function prefetchCalendar() {
  try {
    let tz = 'America/New_York';
    const venueRes = await fetch('/api/venues/me', { cache: 'no-store' });
    if (venueRes.ok) {
      const v = (await venueRes.json()) as { timezone?: string };
      tz = resolveVenueTimezone(v?.timezone);
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const ymdStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastD = new Date(year, month + 1, 0).getDate();
    const ymdEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
    const from = new Date(`${ymdStart}T00:00:00`).toISOString();
    const to = new Date(`${ymdEnd}T23:59:59.999`).toISOString();

    const [evRes, gRes, calRes] = await Promise.all([
      fetch(`/api/calendar?from=${from}&to=${to}`, { cache: 'no-store' }),
      fetch(`/api/calendar/google/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        cache: 'no-store',
      }),
      fetch('/api/venue-calendars', { cache: 'no-store' }),
    ]);
    const localEvents = evRes.ok ? await evRes.json() : [];
    const googleEvents = gRes.ok ? await gRes.json() : [];
    const vcals = calRes.ok ? await calRes.json() : [];
    const colorMap = Object.fromEntries((vcals as { id: string; color: string }[]).map((c) => [c.id, c.color]));
    const enriched = (localEvents as { calendar_id?: string | null }[]).map((e) => ({
      ...e,
      calendar_color: e.calendar_id ? (colorMap[e.calendar_id] ?? null) : null,
    }));
    setClientCache(`cal:events:${year}-${month}`, [...enriched, ...googleEvents]);
  } catch {
    // Best-effort.
  }
}
