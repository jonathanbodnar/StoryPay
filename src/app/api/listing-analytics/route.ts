import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type EventRow = {
  session_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  referrer: string | null;
  utm_source: string | null;
  device_type: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  created_at: string;
};

export async function GET(req: Request) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, slug, gallery_images, cover_image_url, directory_plan_id, directory_subscription_status, directory_trial_ends_at')
    .eq('id', venueId)
    .maybeSingle();
  if (!venue) return NextResponse.json({ error: 'No venue' }, { status: 404 });

  const v = venue as Record<string, unknown>;
  const planId    = v.directory_plan_id as string | null;
  const subStatus = String(v.directory_subscription_status ?? 'none');
  const trialEndsAtRaw = v.directory_trial_ends_at as string | null;

  // A venue with an active paid trial should NEVER see the upgrade overlay —
  // they're trialing the paid plan and analytics is included.
  const isActivePaidTrial = subStatus === 'trialing';

  // Whether the free-plan trial window is still open (drives the overlay copy).
  const trialWindowActive = Boolean(trialEndsAtRaw) && new Date(trialEndsAtRaw!) > new Date();

  let isFreePlan = false;
  if (planId && !isActivePaidTrial) {
    const { data: plan } = await supabaseAdmin
      .from('directory_plans')
      .select('price_monthly_cents, is_legacy, slug')
      .eq('id', planId)
      .maybeSingle();
    if (plan) {
      const p = plan as Record<string, unknown>;
      const cents  = Number(p.price_monthly_cents ?? 0);
      const slug   = String(p.slug ?? '').toLowerCase();
      const legacy = Boolean(p.is_legacy);
      isFreePlan = !legacy && cents === 0 && !slug.includes('legacy');
    }
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  
  let since = '';
  let until = '';
  let priorFrom = '';
  let days = 30;

  if (fromParam && toParam) {
    // Treat the input dates as local dates (e.g. 2026-05-24 means start of that day in local time)
    // but since we don't know the user's timezone here, we'll just use UTC for consistency
    // with how the chart renders.
    const fromDate = new Date(fromParam + 'T00:00:00Z');
    const toDate = new Date(toParam + 'T23:59:59.999Z');
    since = fromDate.toISOString();
    until = toDate.toISOString();
    
    // Calculate days inclusive of start and end
    const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
    days = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    priorFrom = new Date(fromDate.getTime() - diffTime).toISOString();
  } else {
    days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
    const now = Date.now();
    since = new Date(now - days * 86400000).toISOString();
    until = new Date(now).toISOString();
    priorFrom = new Date(now - days * 2 * 86400000).toISOString();
  }

  // Fetch current + prior period then split. PostgREST caps a single request
  // at 1000 rows, so we paginate in 1000-row pages to pull EVERY event in the
  // window — otherwise the oldest 1000 events come back and recent days
  // (including today) get silently truncated, making the chart look empty.
  const PAGE = 1000;
  const MAX_PAGES = 60; // safety cap → up to 60k events
  const allEvents: EventRow[] = [];
  let fetchError: { message: string } | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from('listing_events')
      .select('session_id, event_type, event_data, referrer, utm_source, device_type, country, region, city, created_at')
      .eq('venue_id', venueId)
      .gte('created_at', priorFrom)
      .lte('created_at', until)
      .order('created_at', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) { fetchError = error; break; }
    const batch = (data ?? []) as EventRow[];
    allEvents.push(...batch);
    if (batch.length < PAGE) break; // last page reached
  }

  if (fetchError) {
    if (/listing_events/i.test(fetchError.message)) return NextResponse.json(emptyPayload(days));
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const rows = allEvents;
  const current = rows.filter(r => r.created_at >= since);
  const prior    = rows.filter(r => r.created_at < since);

  // Also fetch leads created in period (for funnel bottom)
  let leadsQuery = supabaseAdmin
    .from('leads')
    .select('id, created_at, source')
    .eq('venue_id', venueId)
    .gte('created_at', since);
  if (until) {
    leadsQuery = leadsQuery.lte('created_at', until);
  }
  const { data: leads } = await leadsQuery;
  
  const { data: priorLeads } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('venue_id', venueId)
    .gte('created_at', priorFrom)
    .lt('created_at', since);

  const galleryImages = Array.isArray((venue as Record<string,unknown>).gallery_images)
    ? (venue as Record<string,unknown>).gallery_images as string[]
    : [];

  return NextResponse.json({
    days,
    venue_name: String(v.name ?? ''),
    venue_slug: String(v.slug ?? ''),
    gallery_images: galleryImages,
    is_free_plan: isFreePlan,
    trial_window_active: isFreePlan && trialWindowActive,
    trial_ends_at: isFreePlan ? (trialEndsAtRaw ?? null) : null,
    ...buildMetrics(current, leads ?? [], days, until),
    prior: buildPriorMetrics(prior, priorLeads ?? []),
  });
}

// ── Core metric builder ────────────────────────────────────────────────────────

function buildMetrics(rows: EventRow[], leads: { id: string; created_at: string }[], days: number, until: string) {
  const pageViews = rows.filter(r => r.event_type === 'page_view');
  const impressions = rows.filter(r => r.event_type === 'listing_impression');
  const allSessions = new Set(rows.map(r => r.session_id));
  // A "view session" is one that has a page_view OR a heartbeat (heartbeats
  // fire on mount so they effectively mark the same sessions as page views)
  const viewSessions = new Set(
    rows.filter(r => r.event_type === 'page_view' || r.event_type === 'session_heartbeat').map(r => r.session_id)
  );
  const formOpenSessions = new Set(rows.filter(r => r.event_type === 'contact_form_open').map(r => r.session_id));
  const formSubmitSessions = new Set(rows.filter(r => r.event_type === 'contact_form_submit').map(r => r.session_id));

  const conversionRate = viewSessions.size
    ? Math.round((formSubmitSessions.size / viewSessions.size) * 1000) / 10
    : 0;

  // ── Session duration (seconds) ────────────────────────────────────────────
  const sessionTimes: Record<string, { first: number; last: number }> = {};
  for (const row of rows) {
    const t = new Date(row.created_at).getTime();
    if (!sessionTimes[row.session_id]) sessionTimes[row.session_id] = { first: t, last: t };
    else {
      if (t < sessionTimes[row.session_id].first) sessionTimes[row.session_id].first = t;
      if (t > sessionTimes[row.session_id].last) sessionTimes[row.session_id].last = t;
    }
  }
  const durations = Object.values(sessionTimes)
    .map(s => (s.last - s.first) / 1000)
    .filter(d => d > 0 && d < 3600); // ignore 0s bounces and outliers
  const avgSessionDuration = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // ── Daily breakdown ───────────────────────────────────────────────────────
  // Bucket events into per-day counts. We then backfill EVERY day in the
  // requested range (even days with zero traffic) so the chart renders a
  // continuous line across the full window — otherwise sparse weeks look
  // like missing data and users assume "view counts aren't saving."
  //
  // Historical retention: `listing_events` rows are kept indefinitely. There
  // is no TTL, cron prune, or DELETE pipeline anywhere in the codebase that
  // touches this table — the only delete pathway is venues.id ON DELETE
  // CASCADE if a venue itself is removed. So a 30-day (or 365-day) lookback
  // can always rely on every event ever recorded for the venue being present.
  const dailyMap: Record<string, { views: number; sessions: Set<string>; impressions: number }> = {};
  const viewRows = rows.filter(r => r.event_type === 'page_view' || r.event_type === 'session_heartbeat' || r.event_type === 'listing_impression');
  for (const row of viewRows) {
    const day = row.created_at.slice(0, 10);
    if (!dailyMap[day]) dailyMap[day] = { views: 0, sessions: new Set(), impressions: 0 };
    if (row.event_type === 'page_view' || row.event_type === 'session_heartbeat') { dailyMap[day].sessions.add(row.session_id); if (row.event_type === 'page_view') dailyMap[day].views++; }
    if (row.event_type === 'listing_impression') dailyMap[day].impressions++;
  }

  // Build the full date axis in UTC so the keys match `created_at.slice(0,10)`
  // Render oldest → newest so the chart x-axis flows left-to-right naturally.
  const daily: { date: string; views: number; unique_sessions: number; impressions: number }[] = [];
  const endUtc = new Date(until);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endUtc);
    d.setUTCDate(endUtc.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const bucket = dailyMap[key];
    daily.push({
      date: key,
      views: bucket?.views ?? 0,
      unique_sessions: bucket?.sessions.size ?? 0,
      impressions: bucket?.impressions ?? 0,
    });
  }

  // ── Scroll depth ──────────────────────────────────────────────────────────
  const s25 = new Set(rows.filter(r => r.event_type === 'scroll_25').map(r => r.session_id)).size;
  const s50 = new Set(rows.filter(r => r.event_type === 'scroll_50').map(r => r.session_id)).size;
  const s75 = new Set(rows.filter(r => r.event_type === 'scroll_75').map(r => r.session_id)).size;
  const s100 = new Set(rows.filter(r => r.event_type === 'scroll_100').map(r => r.session_id)).size;
  const vsz = viewSessions.size || 1;
  const scrollDepth = {
    pct_25:  Math.round((s25  / vsz) * 100),
    pct_50:  Math.round((s50  / vsz) * 100),
    pct_75:  Math.round((s75  / vsz) * 100),
    pct_100: Math.round((s100 / vsz) * 100),
  };

  // ── Event counts ──────────────────────────────────────────────────────────
  const eventCounts: Record<string, number> = {};
  for (const row of rows) eventCounts[row.event_type] = (eventCounts[row.event_type] ?? 0) + 1;

  // ── Devices ───────────────────────────────────────────────────────────────
  const deviceMap: Record<string, number> = {};
  for (const row of pageViews) {
    const d = row.device_type || 'unknown';
    deviceMap[d] = (deviceMap[d] ?? 0) + 1;
  }

  // ── Referrers ─────────────────────────────────────────────────────────────
  const referrerMap: Record<string, number> = {};
  for (const row of pageViews) {
    const ref = parseReferrerLabel(row.referrer, row.utm_source);
    referrerMap[ref] = (referrerMap[ref] ?? 0) + 1;
  }
  const referrers = Object.entries(referrerMap)
    .sort(([, a], [, b]) => b - a).slice(0, 10)
    .map(([source, count]) => ({ source, count }));

  // ── Geography ─────────────────────────────────────────────────────────────
  // Countries aggregate directly. States/cities are keyed as "Region|Country"
  // or "City|Region|Country" so that identical names in different countries
  // don't collide (e.g. "Ontario, CA" vs "Ontario, US").
  const countryMap: Record<string, number> = {};
  const stateMap: Record<string, { country: string; region: string; count: number }> = {};
  const cityMap: Record<string, { city: string; region: string | null; country: string | null; count: number }> = {};
  for (const row of pageViews) {
    if (row.country) countryMap[row.country] = (countryMap[row.country] ?? 0) + 1;
    if (row.region && row.country) {
      const key = `${row.region}|${row.country}`;
      if (!stateMap[key]) stateMap[key] = { country: row.country, region: row.region, count: 0 };
      stateMap[key].count++;
    }
    if (row.city) {
      const key = `${row.city}|${row.region ?? ''}|${row.country ?? ''}`;
      if (!cityMap[key]) cityMap[key] = { city: row.city, region: row.region, country: row.country, count: 0 };
      cityMap[key].count++;
    }
  }
  const topCountries = Object.entries(countryMap).sort(([,a],[,b])=>b-a).slice(0,10).map(([country,count])=>({country,count}));
  const topStates    = Object.values(stateMap).sort((a,b)=>b.count-a.count).slice(0,10);
  const topCities    = Object.values(cityMap).sort((a,b)=>b.count-a.count).slice(0,10);

  // ── DOW heatmap ───────────────────────────────────────────────────────────
  const dowCounts = Array(7).fill(0) as number[];
  for (const lead of leads) {
    dowCounts[new Date(lead.created_at).getDay()]++;
  }

  // ── Photos ────────────────────────────────────────────────────────────────
  const photoIndexMap: Record<number, number> = {};
  for (const row of rows.filter(r => r.event_type === 'photo_view')) {
    const idx = (row.event_data as { photo_index?: number })?.photo_index ?? 0;
    photoIndexMap[idx] = (photoIndexMap[idx] ?? 0) + 1;
  }
  const photoViews = Object.entries(photoIndexMap)
    .sort(([a],[b]) => Number(a)-Number(b))
    .map(([index,count]) => ({ index: Number(index), count }));

  // ── Social ────────────────────────────────────────────────────────────────
  const socialMap: Record<string, number> = {};
  for (const row of rows.filter(r => r.event_type === 'social_click')) {
    const p = (row.event_data as { platform?: string })?.platform || 'unknown';
    socialMap[p] = (socialMap[p] ?? 0) + 1;
  }

  // ── Funnel ────────────────────────────────────────────────────────────────
  const funnel = [
    { step: 'Impressions',    count: impressions.length,          pct: 100 },
    { step: 'Listing views',  count: pageViews.length,            pct: impressions.length ? Math.round((pageViews.length / impressions.length) * 100) : null },
    { step: 'Unique visitors',count: viewSessions.size,           pct: pageViews.length ? Math.round((viewSessions.size / pageViews.length) * 100) : null },
    { step: 'Form opens',     count: formOpenSessions.size,       pct: viewSessions.size ? Math.round((formOpenSessions.size / viewSessions.size) * 100) : null },
    { step: 'Inquiries sent', count: formSubmitSessions.size,     pct: formOpenSessions.size ? Math.round((formSubmitSessions.size / formOpenSessions.size) * 100) : null },
    { step: 'Leads created',  count: leads.length,                pct: formSubmitSessions.size ? Math.round((leads.length / formSubmitSessions.size) * 100) : null },
  ];

  return {
    total_views:            pageViews.length || viewSessions.size, // heartbeat sessions count as views when no page_view yet
    total_impressions:      impressions.length,
    unique_sessions:        viewSessions.size,
    total_interactions:     allSessions.size,
    conversion_rate:        conversionRate,
    contact_form_opens:     formOpenSessions.size,
    contact_form_submits:   formSubmitSessions.size,
    leads_created:          leads.length,
    avg_session_duration:   avgSessionDuration,
    daily,
    event_counts:           eventCounts,
    scroll_depth:           scrollDepth,
    devices:                deviceMap,
    referrers,
    top_countries:          topCountries,
    top_states:             topStates,
    top_cities:             topCities,
    inquiry_dow:            dowCounts,
    photo_views:            photoViews,
    social_clicks:          socialMap,
    funnel,
  };
}

function buildPriorMetrics(rows: EventRow[], leads: { id: string }[]) {
  const pageViews = rows.filter(r => r.event_type === 'page_view');
  const viewSessions = new Set(pageViews.map(r => r.session_id));
  const formSubmits = new Set(rows.filter(r => r.event_type === 'contact_form_submit').map(r => r.session_id));
  return {
    total_views:          pageViews.length,
    unique_sessions:      viewSessions.size,
    contact_form_submits: formSubmits.size,
    leads_created:        leads.length,
    conversion_rate: viewSessions.size
      ? Math.round((formSubmits.size / viewSessions.size) * 1000) / 10 : 0,
  };
}

function parseReferrerLabel(referrer: string | null, utmSource: string | null): string {
  if (utmSource) return `UTM: ${utmSource}`;
  if (!referrer) return 'Direct / Unknown';
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    if (host.includes('google'))    return 'Google';
    if (host.includes('facebook') || host.includes('fb.com')) return 'Facebook';
    if (host.includes('instagram')) return 'Instagram';
    if (host.includes('pinterest')) return 'Pinterest';
    if (host.includes('tiktok'))    return 'TikTok';
    if (host.includes('bing'))      return 'Bing';
    if (host.includes('yahoo'))     return 'Yahoo';
    return host;
  } catch { return 'Direct / Unknown'; }
}

function emptyPayload(days: number) {
  return {
    days, venue_name: '', venue_slug: '', gallery_images: [],
    total_views: 0, total_impressions: 0, unique_sessions: 0, total_interactions: 0,
    conversion_rate: 0, contact_form_opens: 0, contact_form_submits: 0,
    leads_created: 0, avg_session_duration: 0,
    daily: [], event_counts: {},
    scroll_depth: { pct_25: 0, pct_50: 0, pct_75: 0, pct_100: 0 },
    devices: {}, referrers: [], top_countries: [], top_states: [], top_cities: [],
    inquiry_dow: [0,0,0,0,0,0,0], photo_views: [], social_clicks: {},
    funnel: [],
    prior: { total_views: 0, unique_sessions: 0, contact_form_submits: 0, leads_created: 0, conversion_rate: 0 },
    _migration_pending: true,
  };
}
