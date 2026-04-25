import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Country code → flag emoji
function flag(code: string | null): string {
  if (!code || code.length !== 2) return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1A5 + c.charCodeAt(0)));
}

const EVENT_LABELS: Record<string, string> = {
  page_view:            'Viewing listing',
  scroll_25:            'Reading (25%)',
  scroll_50:            'Reading (50%)',
  scroll_75:            'Reading (75%)',
  scroll_100:           'Finished reading',
  photo_view:           'Browsing photos',
  faq_open:             'Reading FAQs',
  map_click:            'Checked location',
  social_click:         'Clicked social link',
  contact_form_open:    'Opened contact form',
  contact_form_submit:  'Sent inquiry ✉️',
  listing_impression:   'Found in search',
  session_heartbeat:    'Browsing listing',
};

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = Date.now();
  // 90s window for "right now" — covers one missed 30s heartbeat ping
  const since90s = new Date(now - 90  * 1000).toISOString();
  const since5m  = new Date(now - 5  * 60 * 1000).toISOString();
  const since30m = new Date(now - 30 * 60 * 1000).toISOString();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // Try with latitude/longitude first; fall back if migration 057 hasn't
  // been applied yet (column doesn't exist -> Postgres error 42703).
  let recent: Array<{
    session_id: string;
    event_type: string;
    country: string | null;
    region: string | null;
    city: string | null;
    device_type: string | null;
    created_at: string;
    latitude?: number | null;
    longitude?: number | null;
  }> | null = null;
  let error: { message: string } | null = null;
  {
    const res = await supabaseAdmin
      .from('listing_events')
      .select('session_id, event_type, country, region, city, device_type, created_at, latitude, longitude')
      .eq('venue_id', venueId)
      .gte('created_at', since30m)
      .order('created_at', { ascending: false })
      .limit(200);
    recent = res.data;
    error = res.error;
  }
  if (error && /latitude|longitude/i.test(error.message)) {
    const res = await supabaseAdmin
      .from('listing_events')
      .select('session_id, event_type, country, region, city, device_type, created_at')
      .eq('venue_id', venueId)
      .gte('created_at', since30m)
      .order('created_at', { ascending: false })
      .limit(200);
    recent = res.data;
    error = res.error;
  }

  if (error) {
    if (/listing_events/i.test(error.message)) {
      return NextResponse.json({ active_now: 0, active_5m: 0, active_30m: 0, today_views: 0, activity: [], geo_live: [], geo_points: [], _migration_pending: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = recent ?? [];

  // "Right now" = sessions with a heartbeat in the last 90 seconds
  const sessionsNow  = new Set(
    rows.filter(r => r.created_at >= since90s && r.event_type === 'session_heartbeat').map(r => r.session_id)
  );
  // Fallback: if heartbeats aren't flowing yet, use any event in last 90s
  const sessionsNowFallback = new Set(
    rows.filter(r => r.created_at >= since90s).map(r => r.session_id)
  );
  const activeNow = sessionsNow.size || sessionsNowFallback.size;

  // Active unique sessions in last 5 min / 30 min (any event type)
  const sessions5m  = new Set(rows.filter(r => r.created_at >= since5m).map(r => r.session_id));
  const sessions30m = new Set(rows.map(r => r.session_id));

  // Today's page views (24h)
  const { count: todayViews } = await supabaseAdmin
    .from('listing_events')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .eq('event_type', 'page_view')
    .gte('created_at', since24h);

  // Recent activity feed — last event per session, most recent first
  const seenSessions = new Set<string>();
  const activity: { session_id: string; event_type: string; label: string; country: string | null; region: string | null; city: string | null; flag: string; device_type: string | null; ago_seconds: number }[] = [];

  for (const row of rows) {
    if (seenSessions.has(row.session_id)) continue;
    seenSessions.add(row.session_id);
    const agoSeconds = Math.round((now - new Date(row.created_at).getTime()) / 1000);
    activity.push({
      session_id: row.session_id,
      event_type: row.event_type,
      label: EVENT_LABELS[row.event_type] ?? row.event_type,
      country: row.country,
      region: row.region,
      city: row.city,
      flag: flag(row.country),
      device_type: row.device_type,
      ago_seconds: agoSeconds,
    });
    if (activity.length >= 20) break;
  }

  // Geographic breakdown of live sessions (last 30 min). Cities are captured
  // as "City, Region" when a region is known so US states show up in the UI
  // (e.g. "New Albany, Ohio") without requiring a schema change.
  const geoMap: Record<string, { count: number; flag: string; places: Set<string> }> = {};
  for (const row of rows) {
    const key = row.country || 'Unknown';
    if (!geoMap[key]) geoMap[key] = { count: 0, flag: flag(row.country), places: new Set() };
    geoMap[key].count++;
    const place = [row.city, row.region].filter(Boolean).join(', ');
    if (place) geoMap[key].places.add(place);
  }
  const geoLive = Object.entries(geoMap)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 12)
    .map(([country, v]) => ({
      country,
      flag: v.flag,
      count: v.count,
      cities: [...v.places].slice(0, 3),
    }));

  // Map points for the realtime world map. One marker per active session so
  // the same browser tab sending 10 heartbeats shows up once, not ten times.
  // We take the newest row per session (rows are already sorted DESC by
  // created_at) which represents where that visitor currently is.
  type GeoPoint = {
    session_id: string;
    lat: number;
    lng: number;
    city: string | null;
    region: string | null;
    country: string | null;
    flag: string;
    label: string;
    ago_seconds: number;
    live: boolean;
  };
  const seenGeo = new Set<string>();
  const geoPoints: GeoPoint[] = [];
  for (const row of rows) {
    if (seenGeo.has(row.session_id)) continue;
    if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') continue;
    seenGeo.add(row.session_id);
    const agoSeconds = Math.round((now - new Date(row.created_at).getTime()) / 1000);
    geoPoints.push({
      session_id: row.session_id,
      lat: row.latitude,
      lng: row.longitude,
      city: row.city,
      region: row.region,
      country: row.country,
      flag: flag(row.country),
      label: EVENT_LABELS[row.event_type] ?? row.event_type,
      ago_seconds: agoSeconds,
      live: agoSeconds <= 90, // pulsing marker for "right now" visitors
    });
  }

  return NextResponse.json({
    active_now:  activeNow,
    active_5m:   sessions5m.size,
    active_30m:  sessions30m.size,
    today_views: todayViews ?? 0,
    activity,
    geo_live:    geoLive,
    geo_points:  geoPoints,
  });
}
