import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/analytics — usage analytics for the super-admin tab.
 *   Query params (preferred):
 *     from   YYYY-MM-DD start of window (inclusive)
 *     to     YYYY-MM-DD end of window (inclusive)
 *   Legacy fallback:
 *     days   lookback window (default 30; 0 = all time)
 *
 * Returns top-line metrics, top pages, top clicked elements, a feature-trending
 * comparison (this period vs the equal-length prior period), a daily
 * time-series, and a live recent-activity feed.
 */

async function requireAnalyticsAccess() {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin || id.allowedTabs.has('analytics');
}

interface EventRow {
  id: string;
  created_at: string;
  event: string;
  kind: string;
  venue_id: string | null;
  user_email: string | null;
  role: string | null;
  path: string | null;
  label: string | null;
  session_id: string | null;
}

function topN(counts: Map<string, number>, n: number): { key: string; count: number }[] {
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

export async function GET(req: NextRequest) {
  if (!(await requireAnalyticsAccess())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const fromParam = sp.get('from');
    const toParam = sp.get('to');

    // Resolve the active window as [sinceMs, untilMs).
    let sinceMs: number;
    let untilMs: number;
    let hasWindow: boolean;
    if (fromParam && toParam) {
      sinceMs = new Date(`${fromParam}T00:00:00.000Z`).getTime();
      untilMs = new Date(`${toParam}T23:59:59.999Z`).getTime() + 1;
      hasWindow = true;
    } else {
      const days = sp.has('days') ? Number(sp.get('days')) : 30;
      hasWindow = Number.isFinite(days) && days > 0;
      untilMs = Date.now();
      sinceMs = hasWindow ? untilMs - days * 24 * 60 * 60 * 1000 : 0;
    }

    const sinceIso = new Date(hasWindow ? sinceMs : 0).toISOString();
    const untilIso = new Date(untilMs).toISOString();
    const windowMs = untilMs - sinceMs;
    // Equal-length prior window for trending deltas.
    const prevSinceIso = hasWindow ? new Date(sinceMs - windowMs).toISOString() : null;

    // ── Pull the window's events (capped) for in-memory aggregation. ──────────
    const rowsPromise = supabaseAdmin
      .from('analytics_events')
      .select('id, created_at, event, kind, venue_id, user_email, role, path, label, session_id')
      .gte('created_at', sinceIso)
      .lte('created_at', untilIso)
      .order('created_at', { ascending: false })
      .limit(50000);

    // ── Signups: distinct venues that signed up within the window. ────────────
    let milestoneQuery = supabaseAdmin
      .from('analytics_events')
      .select('event, venue_id')
      .eq('kind', 'milestone')
      .eq('event', 'signup')
      .lte('created_at', untilIso)
      .limit(50000);
    if (hasWindow) milestoneQuery = milestoneQuery.gte('created_at', sinceIso);
    const milestonePromise = milestoneQuery;

    // ── Trending: event volume this window vs the previous window. ────────────
    const prevRowsPromise = prevSinceIso
      ? supabaseAdmin
          .from('analytics_events')
          .select('event')
          .gte('created_at', prevSinceIso)
          .lt('created_at', sinceIso)
          .limit(50000)
      : Promise.resolve({ data: null, error: null });

    const [
      { data: rowsRaw, error },
      { data: milestoneRows },
      { data: prevRows }
    ] = await Promise.all([rowsPromise, milestonePromise, prevRowsPromise]);

    if (error) throw new Error(error.message);
    const rows = (rowsRaw ?? []) as EventRow[];

    // ── Top-line metrics ─────────────────────────────────────────────────────
    let pageviews = 0;
    let clicks = 0;
    const activeVenues = new Set<string>();
    const activeSessions = new Set<string>();
    const pathCounts = new Map<string, number>();
    const clickCounts = new Map<string, number>();
    const eventCountsThis = new Map<string, number>();

    for (const r of rows) {
      if (r.venue_id) activeVenues.add(r.venue_id);
      if (r.session_id) activeSessions.add(r.session_id);
      if (r.event === 'pageview') {
        pageviews++;
        if (r.path) pathCounts.set(r.path, (pathCounts.get(r.path) ?? 0) + 1);
      } else if (r.event === 'click') {
        clicks++;
        if (r.label) clickCounts.set(r.label, (clickCounts.get(r.label) ?? 0) + 1);
      }
      eventCountsThis.set(r.event, (eventCountsThis.get(r.event) ?? 0) + 1);
    }

    const signupVenues = new Set<string>();
    for (const r of (milestoneRows ?? []) as { event: string; venue_id: string | null }[]) {
      if (r.venue_id) signupVenues.add(r.venue_id);
    }
    const signupCount = signupVenues.size;

    let trending: { event: string; count: number; prev: number; delta: number }[] = [];
    if (prevSinceIso) {
      const prevCounts = new Map<string, number>();
      for (const r of (prevRows ?? []) as { event: string }[]) {
        prevCounts.set(r.event, (prevCounts.get(r.event) ?? 0) + 1);
      }
      const allEvents = new Set<string>([...eventCountsThis.keys(), ...prevCounts.keys()]);
      trending = Array.from(allEvents).map((event) => {
        const count = eventCountsThis.get(event) ?? 0;
        const prev = prevCounts.get(event) ?? 0;
        const delta = prev > 0 ? Math.round(((count - prev) / prev) * 100) : (count > 0 ? 100 : 0);
        return { event, count, prev, delta };
      }).sort((a, b) => b.count - a.count).slice(0, 12);
    }

    // ── Daily time-series (events per day). ──────────────────────────────────
    const dayCounts = new Map<string, number>();
    for (const r of rows) {
      const day = r.created_at.slice(0, 10);
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }
    const timeseries = Array.from(dayCounts.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));

    // ── Live feed: most recent 40 events, enriched with venue names. ─────────
    const recent = rows.slice(0, 40);
    const venueIds = Array.from(new Set(recent.map((r) => r.venue_id).filter((v): v is string => !!v)));
    const venueNames: Record<string, string> = {};
    if (venueIds.length > 0) {
      const { data: venues } = await supabaseAdmin
        .from('venues')
        .select('id, name')
        .in('id', venueIds);
      for (const v of (venues ?? []) as { id: string; name: string | null }[]) {
        venueNames[v.id] = v.name ?? '';
      }
    }

    return NextResponse.json({
      window: { sinceIso, untilIso },
      totals: {
        events:        rows.length,
        pageviews,
        clicks,
        activeVenues:  activeVenues.size,
        activeSessions: activeSessions.size,
        signups:       signupCount,
      },
      topPages:  topN(pathCounts, 10).map((p) => ({ path: p.key, count: p.count })),
      topClicks: topN(clickCounts, 12).map((c) => ({ label: c.key, count: c.count })),
      trending,
      timeseries,
      recent,
      venueNames,
    });
  } catch (err) {
    console.error('[admin/analytics GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
