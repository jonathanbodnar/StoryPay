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

  const { data: recent, error } = await supabaseAdmin
    .from('listing_events')
    .select('session_id, event_type, country, city, device_type, created_at')
    .eq('venue_id', venueId)
    .gte('created_at', since30m)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    if (/listing_events/i.test(error.message)) {
      return NextResponse.json({ active_now: 0, active_5m: 0, active_30m: 0, today_views: 0, activity: [], geo_live: [], _migration_pending: true });
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
  const activity: { session_id: string; event_type: string; label: string; country: string | null; city: string | null; flag: string; device_type: string | null; ago_seconds: number }[] = [];

  for (const row of rows) {
    if (seenSessions.has(row.session_id)) continue;
    seenSessions.add(row.session_id);
    const agoSeconds = Math.round((now - new Date(row.created_at).getTime()) / 1000);
    activity.push({
      session_id: row.session_id,
      event_type: row.event_type,
      label: EVENT_LABELS[row.event_type] ?? row.event_type,
      country: row.country,
      city: row.city,
      flag: flag(row.country),
      device_type: row.device_type,
      ago_seconds: agoSeconds,
    });
    if (activity.length >= 20) break;
  }

  // Geographic breakdown of live sessions (last 30 min)
  const geoMap: Record<string, { count: number; flag: string; cities: Set<string> }> = {};
  for (const row of rows) {
    const key = row.country || 'Unknown';
    if (!geoMap[key]) geoMap[key] = { count: 0, flag: flag(row.country), cities: new Set() };
    geoMap[key].count++;
    if (row.city) geoMap[key].cities.add(row.city);
  }
  const geoLive = Object.entries(geoMap)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 12)
    .map(([country, v]) => ({
      country,
      flag: v.flag,
      count: v.count,
      cities: [...v.cities].slice(0, 3),
    }));

  return NextResponse.json({
    active_now:  activeNow,
    active_5m:   sessions5m.size,
    active_30m:  sessions30m.size,
    today_views: todayViews ?? 0,
    activity,
    geo_live:    geoLive,
  });
}
