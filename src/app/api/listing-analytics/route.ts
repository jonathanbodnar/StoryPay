import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify venue exists
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('id', venueId)
    .maybeSingle();
  if (!venue) return NextResponse.json({ error: 'No venue' }, { status: 404 });

  const url = new URL(req.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all events in range
  const { data: events, error } = await supabaseAdmin
    .from('listing_events')
    .select('session_id, event_type, event_data, referrer, utm_source, device_type, country, city, created_at')
    .eq('venue_id', venueId)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) {
    // Migration not yet run
    if (/listing_events/i.test(error.message)) {
      return NextResponse.json(emptyPayload(days));
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = events ?? [];

  // ── Totals ───────────────────────────────────────────────────────────
  const pageViews = rows.filter(r => r.event_type === 'page_view');
  const uniqueSessions = new Set(rows.map(r => r.session_id)).size;
  const uniqueViewSessions = new Set(pageViews.map(r => r.session_id)).size;

  // ── Daily views (for sparkline / chart) ──────────────────────────────
  const dailyMap: Record<string, { views: number; sessions: Set<string> }> = {};
  for (const row of pageViews) {
    const day = row.created_at.slice(0, 10);
    if (!dailyMap[day]) dailyMap[day] = { views: 0, sessions: new Set() };
    dailyMap[day].views++;
    dailyMap[day].sessions.add(row.session_id);
  }
  const daily = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, views: v.views, unique_sessions: v.sessions.size }));

  // ── Event breakdown ───────────────────────────────────────────────────
  const eventCounts: Record<string, number> = {};
  for (const row of rows) {
    eventCounts[row.event_type] = (eventCounts[row.event_type] ?? 0) + 1;
  }

  // ── Scroll depth (% of sessions reaching each depth) ─────────────────
  const scrollSessions = { s25: new Set<string>(), s50: new Set<string>(), s75: new Set<string>(), s100: new Set<string>() };
  for (const row of rows) {
    if (row.event_type === 'scroll_25') scrollSessions.s25.add(row.session_id);
    if (row.event_type === 'scroll_50') scrollSessions.s50.add(row.session_id);
    if (row.event_type === 'scroll_75') scrollSessions.s75.add(row.session_id);
    if (row.event_type === 'scroll_100') scrollSessions.s100.add(row.session_id);
  }
  const scrollDepth = {
    pct_25: uniqueViewSessions ? Math.round((scrollSessions.s25.size / uniqueViewSessions) * 100) : 0,
    pct_50: uniqueViewSessions ? Math.round((scrollSessions.s50.size / uniqueViewSessions) * 100) : 0,
    pct_75: uniqueViewSessions ? Math.round((scrollSessions.s75.size / uniqueViewSessions) * 100) : 0,
    pct_100: uniqueViewSessions ? Math.round((scrollSessions.s100.size / uniqueViewSessions) * 100) : 0,
  };

  // ── Device breakdown ──────────────────────────────────────────────────
  const deviceMap: Record<string, number> = {};
  for (const row of pageViews) {
    const d = row.device_type || 'unknown';
    deviceMap[d] = (deviceMap[d] ?? 0) + 1;
  }

  // ── Referrer breakdown ────────────────────────────────────────────────
  const referrerMap: Record<string, number> = {};
  for (const row of pageViews) {
    const ref = parseReferrerLabel(row.referrer, row.utm_source);
    referrerMap[ref] = (referrerMap[ref] ?? 0) + 1;
  }
  const referrers = Object.entries(referrerMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([source, count]) => ({ source, count }));

  // ── Geography (top countries + cities) ───────────────────────────────
  const countryMap: Record<string, number> = {};
  const cityMap: Record<string, number> = {};
  for (const row of pageViews) {
    if (row.country) countryMap[row.country] = (countryMap[row.country] ?? 0) + 1;
    if (row.city) cityMap[row.city] = (cityMap[row.city] ?? 0) + 1;
  }
  const topCountries = Object.entries(countryMap)
    .sort(([, a], [, b]) => b - a).slice(0, 10)
    .map(([country, count]) => ({ country, count }));
  const topCities = Object.entries(cityMap)
    .sort(([, a], [, b]) => b - a).slice(0, 10)
    .map(([city, count]) => ({ city, count }));

  // ── Engagement metrics ────────────────────────────────────────────────
  const contactFormSessions = new Set(
    rows.filter(r => r.event_type === 'contact_form_open').map(r => r.session_id)
  ).size;
  const contactSubmitSessions = new Set(
    rows.filter(r => r.event_type === 'contact_form_submit').map(r => r.session_id)
  ).size;
  const conversionRate = uniqueViewSessions
    ? Math.round((contactSubmitSessions / uniqueViewSessions) * 100 * 10) / 10
    : 0;

  // ── Inquiry day-of-week heatmap (0=Sun … 6=Sat) ──────────────────────
  const dowCounts = Array(7).fill(0) as number[];
  for (const row of rows.filter(r => r.event_type === 'contact_form_submit')) {
    dowCounts[new Date(row.created_at).getDay()]++;
  }

  // ── Photo interaction counts ──────────────────────────────────────────
  const photoIndexMap: Record<number, number> = {};
  for (const row of rows.filter(r => r.event_type === 'photo_view')) {
    const idx = (row.event_data as { photo_index?: number })?.photo_index ?? 0;
    photoIndexMap[idx] = (photoIndexMap[idx] ?? 0) + 1;
  }
  const photoViews = Object.entries(photoIndexMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([index, count]) => ({ index: Number(index), count }));

  // ── Social link clicks ────────────────────────────────────────────────
  const socialMap: Record<string, number> = {};
  for (const row of rows.filter(r => r.event_type === 'social_click')) {
    const p = (row.event_data as { platform?: string })?.platform || 'unknown';
    socialMap[p] = (socialMap[p] ?? 0) + 1;
  }

  return NextResponse.json({
    days,
    total_views: pageViews.length,
    unique_sessions: uniqueViewSessions,
    total_interactions: rows.length,
    conversion_rate: conversionRate,
    contact_form_opens: contactFormSessions,
    contact_form_submits: contactSubmitSessions,
    daily,
    event_counts: eventCounts,
    scroll_depth: scrollDepth,
    devices: deviceMap,
    referrers,
    top_countries: topCountries,
    top_cities: topCities,
    inquiry_dow: dowCounts,
    photo_views: photoViews,
    social_clicks: socialMap,
  });
}

function parseReferrerLabel(referrer: string | null, utmSource: string | null): string {
  if (utmSource) return `UTM: ${utmSource}`;
  if (!referrer) return 'Direct / Unknown';
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    if (host.includes('google')) return 'Google';
    if (host.includes('facebook') || host.includes('fb.com')) return 'Facebook';
    if (host.includes('instagram')) return 'Instagram';
    if (host.includes('pinterest')) return 'Pinterest';
    if (host.includes('tiktok')) return 'TikTok';
    if (host.includes('bing')) return 'Bing';
    if (host.includes('yahoo')) return 'Yahoo';
    return host;
  } catch {
    return 'Direct / Unknown';
  }
}

function emptyPayload(days: number) {
  return {
    days,
    total_views: 0,
    unique_sessions: 0,
    total_interactions: 0,
    conversion_rate: 0,
    contact_form_opens: 0,
    contact_form_submits: 0,
    daily: [],
    event_counts: {},
    scroll_depth: { pct_25: 0, pct_50: 0, pct_75: 0, pct_100: 0 },
    devices: {},
    referrers: [],
    top_countries: [],
    top_cities: [],
    inquiry_dow: [0, 0, 0, 0, 0, 0, 0],
    photo_views: [],
    social_clicks: {},
    _migration_pending: true,
  };
}
