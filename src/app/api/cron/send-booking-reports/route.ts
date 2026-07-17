/**
 * GET /api/cron/send-booking-reports
 *
 * Runs daily (e.g. 08:00 UTC). Finds every venue whose
 * report_schedule_enabled = true AND report_schedule_next_at <= now(),
 * compiles a full 30-day Bride Booking System™ report, emails it to the stored
 * addresses, then advances next_at by 30 days.
 *
 * Railway cron example:
 *   0 8 * * *  GET /api/cron/send-booking-reports?secret=$CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  bucketLeadSource,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCE_ORDER,
  type LeadSourceBucket,
} from '@/lib/lead-source';
import { sendEmail } from '@/lib/email';
import {
  buildBookingReportHtml,
  type BookingReportData,
  type FunnelStep,
  type SourceRow,
  type ReferrerRow,
  type GeoCityRow,
  type GeoStateRow,
  type GeoCountryRow,
  type KvRow,
  type MonthRow,
  type TimelineRow,
} from '@/lib/booking-report-email';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

function cronSecret(): string {
  return process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
}
function authorized(req: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return true;
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim();
  const qs     = req.nextUrl.searchParams.get('secret') ?? '';
  return bearer === secret || qs === secret;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

type StageInfo = { name: string; kind: string; position: number };

function leadRank(status: string, stage: StageInfo | undefined): { rank: 1|2|3|4; lost: boolean } {
  const name = (stage?.name ?? '').toLowerCase();
  const kind = stage?.kind ?? '';
  const lost = kind === 'lost' || status === 'not_interested';
  const won  = kind === 'won'  || status === 'booked_wedding';
  if (won) return { rank: 4, lost: false };
  if (name.includes('tour') || name.includes('proposal') || status === 'tour_booked' || status === 'proposal_sent') return { rank: 3, lost };
  if (name.includes('conversation') || name.includes('contacted') || name.includes('follow up') || status === 'contacted') return { rank: 2, lost };
  return { rank: 1, lost };
}

type FullEventRow = {
  session_id: string; event_type: string; event_data: Record<string,unknown>|null;
  referrer: string|null; utm_source: string|null; device_type: string|null;
  country: string|null; region: string|null; city: string|null; created_at: string;
};

type LeadRow = {
  id: string; created_at: string; status: string; stage_id: string|null;
  first_touch_utm: Record<string,unknown>|null; source: string|null;
  referral_source: string|null; guest_count: number|null; wedding_date: string|null;
  opportunity_value: number|null; booking_timeline: string|null;
};

async function buildReportForVenue(venueId: string, venueName: string): Promise<BookingReportData> {
  const days      = 30;
  const now       = Date.now();
  const since     = new Date(now - days * 86_400_000).toISOString();
  const until     = new Date(now).toISOString();
  const priorFrom = new Date(now - days * 2 * 86_400_000).toISOString();

  const [{ data: stagesRaw }, { data: allLeadsRaw }] = await Promise.all([
    supabaseAdmin.from('lead_pipeline_stages').select('id, name, kind, position').eq('venue_id', venueId),
    supabaseAdmin
      .from('leads')
      .select('id, created_at, status, stage_id, first_touch_utm, source, referral_source, guest_count, wedding_date, opportunity_value, booking_timeline')
      .eq('venue_id', venueId)
      .limit(10000),
  ]);

  // Paginate listing_events (both periods)
  const PAGE = 1000;
  const allEvents: FullEventRow[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await supabaseAdmin
      .from('listing_events')
      .select('session_id, event_type, event_data, referrer, utm_source, device_type, country, region, city, created_at')
      .eq('venue_id', venueId)
      .gte('created_at', priorFrom)
      .lte('created_at', until)
      .order('created_at', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data?.length) break;
    allEvents.push(...(data as FullEventRow[]));
    if (data.length < PAGE) break;
  }

  const stageById = new Map<string, StageInfo>(
    ((stagesRaw ?? []) as Array<{ id: string; name: string; kind: string; position: number }>)
      .map(s => [s.id, { name: s.name, kind: s.kind, position: s.position }])
  );

  const allLeads    = (allLeadsRaw ?? []) as LeadRow[];
  const periodLeads = allLeads.filter(r => r.created_at >= since && r.created_at <= until);
  const curEvents   = allEvents.filter(e => e.created_at >= since);
  const priorEvents = allEvents.filter(e => e.created_at <  since);

  // ── Funnel (period) ───────────────────────────────────────────────────────
  const sourceCounts: Record<LeadSourceBucket, number> = { meta: 0, google: 0, direct: 0, other: 0 };
  let leadsCount = 0, conversations = 0, tours = 0, weddings = 0;
  for (const row of periodLeads) {
    const bucket = bucketLeadSource({ first_touch_utm: row.first_touch_utm, source: row.source, referral_source: row.referral_source });
    sourceCounts[bucket] += 1;
    leadsCount += 1;
    const { rank, lost } = leadRank(row.status ?? 'new', row.stage_id ? stageById.get(row.stage_id) : undefined);
    if (rank >= 4) weddings++;
    if (rank >= 3 && !lost) tours++;
    if (rank >= 2 && !lost) conversations++;
  }
  const steps: FunnelStep[] = [
    { key: 'leads',         label: 'Leads',                count: leadsCount    },
    { key: 'conversations', label: 'Conversations Started', count: conversations },
    { key: 'tours',         label: 'Booked Tours',          count: tours         },
    { key: 'weddings',      label: 'Booked Weddings',       count: weddings      },
  ];
  const conversions = steps.slice(1).map((step, i) => {
    const from = steps[i].count;
    return from > 0 ? Math.round((step.count / from) * 100) : null;
  });
  const sources: SourceRow[] = LEAD_SOURCE_ORDER.map(key => ({ key, label: LEAD_SOURCE_LABELS[key], count: sourceCounts[key] }));

  // ── Listing metrics builder ────────────────────────────────────────────────
  function computeMetrics(rows: FullEventRow[]) {
    const pageViews    = rows.filter(r => r.event_type === 'page_view');
    const viewSessions = new Set(rows.filter(r => r.event_type === 'page_view' || r.event_type === 'session_heartbeat').map(r => r.session_id));
    const formSubmits  = new Set(rows.filter(r => r.event_type === 'contact_form_submit').map(r => r.session_id));
    const formOpens    = new Set(rows.filter(r => r.event_type === 'contact_form_open').map(r => r.session_id));
    const sessionTimes: Record<string, { first: number; last: number }> = {};
    for (const row of rows) {
      const t = new Date(row.created_at).getTime();
      if (!sessionTimes[row.session_id]) sessionTimes[row.session_id] = { first: t, last: t };
      else { if (t < sessionTimes[row.session_id].first) sessionTimes[row.session_id].first = t; if (t > sessionTimes[row.session_id].last) sessionTimes[row.session_id].last = t; }
    }
    const durations = Object.values(sessionTimes).map(s => (s.last - s.first) / 1000).filter(d => d > 0 && d < 3600);
    const vsz = viewSessions.size || 1;
    const eventCounts: Record<string, number> = {};
    for (const row of rows) eventCounts[row.event_type] = (eventCounts[row.event_type] ?? 0) + 1;
    const deviceMap: Record<string, number> = {};
    for (const row of pageViews) { const d = row.device_type || 'unknown'; deviceMap[d] = (deviceMap[d] ?? 0) + 1; }
    const referrerMap: Record<string, number> = {};
    for (const row of pageViews) { const ref = parseReferrerLabel(row.referrer, row.utm_source); referrerMap[ref] = (referrerMap[ref] ?? 0) + 1; }
    const countryMap: Record<string, number> = {};
    const stateMap: Record<string, { country: string; region: string; count: number }> = {};
    const cityMap: Record<string, { city: string; region: string|null; country: string|null; count: number }> = {};
    for (const row of pageViews) {
      if (row.country) countryMap[row.country] = (countryMap[row.country] ?? 0) + 1;
      if (row.region && row.country) { const k = `${row.region}|${row.country}`; if (!stateMap[k]) stateMap[k] = { country: row.country, region: row.region, count: 0 }; stateMap[k].count++; }
      if (row.city) { const k = `${row.city}|${row.region??''}|${row.country??''}`; if (!cityMap[k]) cityMap[k] = { city: row.city, region: row.region, country: row.country, count: 0 }; cityMap[k].count++; }
    }
    return {
      totalViews:     pageViews.length || viewSessions.size,
      uniqueVisitors: viewSessions.size,
      formSubmits:    formSubmits.size,
      formOpens:      formOpens.size,
      avgSessionDuration: durations.length ? Math.round(durations.reduce((a,b)=>a+b,0)/durations.length) : null,
      scrollDepth: {
        pct_25:  Math.round((new Set(rows.filter(r=>r.event_type==='scroll_25').map(r=>r.session_id)).size/vsz)*100),
        pct_50:  Math.round((new Set(rows.filter(r=>r.event_type==='scroll_50').map(r=>r.session_id)).size/vsz)*100),
        pct_75:  Math.round((new Set(rows.filter(r=>r.event_type==='scroll_75').map(r=>r.session_id)).size/vsz)*100),
        pct_100: Math.round((new Set(rows.filter(r=>r.event_type==='scroll_100').map(r=>r.session_id)).size/vsz)*100),
      },
      photoViews:   eventCounts['photo_view']   ?? 0,
      faqOpens:     eventCounts['faq_open']     ?? 0,
      mapClicks:    eventCounts['map_click']    ?? 0,
      socialClicks: eventCounts['social_click'] ?? 0,
      devices:      deviceMap,
      referrers:    (Object.entries(referrerMap).sort(([,a],[,b])=>b-a).slice(0,10).map(([source,count])=>({ source, count }))) as ReferrerRow[],
      topCountries: (Object.entries(countryMap).sort(([,a],[,b])=>b-a).slice(0,10).map(([country,count])=>({country,count}))) as GeoCountryRow[],
      topStates:    (Object.values(stateMap).sort((a,b)=>b.count-a.count).slice(0,10)) as GeoStateRow[],
      topCities:    (Object.values(cityMap).sort((a,b)=>b.count-a.count).slice(0,10)) as GeoCityRow[],
    };
  }

  const cur   = computeMetrics(curEvents);
  const prior = computeMetrics(priorEvents);

  // DOW
  const dowCounts = Array(7).fill(0) as number[];
  for (const row of periodLeads) dowCounts[new Date(row.created_at).getDay()]++;

  // ── Lead insights (all-time) ──────────────────────────────────────────────
  const guestRows = allLeads.filter(r => r.guest_count != null);
  const avgGuestCount = guestRows.length ? Math.round(guestRows.reduce((s,r)=>s+(r.guest_count??0),0)/guestRows.length) : null;
  const bookedWithValue = allLeads.filter(r => r.opportunity_value != null && (() => { const st = r.stage_id ? stageById.get(r.stage_id) : undefined; return st?.kind === 'won' || r.status === 'booked_wedding'; })());
  const avgDealValue = bookedWithValue.length ? Math.round(bookedWithValue.reduce((s,r)=>s+(r.opportunity_value??0),0)/bookedWithValue.length) : null;

  const guestBucketMap: Record<string,number> = { '1–50':0,'51–100':0,'101–150':0,'151–200':0,'201–300':0,'300+':0,'Not set':0 };
  for (const r of allLeads) { const g=r.guest_count; if(g==null){guestBucketMap['Not set']++;}else if(g<=50){guestBucketMap['1–50']++;}else if(g<=100){guestBucketMap['51–100']++;}else if(g<=150){guestBucketMap['101–150']++;}else if(g<=200){guestBucketMap['151–200']++;}else if(g<=300){guestBucketMap['201–300']++;}else{guestBucketMap['300+']++;} }
  const guestBuckets: KvRow[] = Object.entries(guestBucketMap).filter(([,v])=>v>0).map(([label,count])=>({label,count}));

  const leadSrcMap: Record<string,number> = {};
  for (const r of allLeads) { const s=r.source||'Unknown'; leadSrcMap[s]=(leadSrcMap[s]??0)+1; }
  const leadSources: KvRow[] = Object.entries(leadSrcMap).sort(([,a],[,b])=>b-a).slice(0,8).map(([label,count])=>({label,count}));

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthMap: Record<string,number> = {};
  for (const r of allLeads) { if(!r.wedding_date)continue; const m=new Date(r.wedding_date+'T00:00:00').getMonth(); const lbl=MONTHS[m]; if(lbl)monthMap[lbl]=(monthMap[lbl]??0)+1; }
  const eventMonths: MonthRow[] = MONTHS.map(m=>({month:m,count:monthMap[m]??0}));

  const valueBucketMap: Record<string,number> = { 'Not set':0,'<$1k':0,'$1k–$5k':0,'$5k–$10k':0,'$10k–$20k':0,'$20k+':0 };
  for (const r of allLeads) { const v=r.opportunity_value; if(v==null){valueBucketMap['Not set']++;}else if(v<1000){valueBucketMap['<$1k']++;}else if(v<5000){valueBucketMap['$1k–$5k']++;}else if(v<10000){valueBucketMap['$5k–$10k']++;}else if(v<20000){valueBucketMap['$10k–$20k']++;}else{valueBucketMap['$20k+']++;} }
  const valueBuckets: KvRow[] = Object.entries(valueBucketMap).filter(([,v])=>v>0).map(([label,count])=>({label,count}));

  const timelineMap: Record<string,number> = {};
  for (const r of allLeads) { const t=r.booking_timeline||'Unknown'; timelineMap[t]=(timelineMap[t]??0)+1; }
  const timelines: TimelineRow[] = Object.entries(timelineMap).sort(([,a],[,b])=>b-a).map(([label,count])=>({label,count}));

  const SITE     = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';
  const fromDate = fmtDate(since);
  const toDate   = fmtDate(until);

  return {
    venueName,
    periodLabel:         `${fromDate} – ${toDate}`,
    fromDate,
    toDate,
    dashboardUrl:        `${SITE}/dashboard/listing`,
    steps,
    conversions,
    sources,
    totalLeads:          leadsCount,
    totalViews:          cur.totalViews,
    uniqueVisitors:      cur.uniqueVisitors,
    formSubmits:         cur.formSubmits,
    avgSessionDuration:  cur.avgSessionDuration,
    priorViews:          prior.totalViews,
    priorUniqueVisitors: prior.uniqueVisitors,
    photoViews:          cur.photoViews,
    formOpens:           cur.formOpens,
    faqOpens:            cur.faqOpens,
    mapClicks:           cur.mapClicks,
    socialClicks:        cur.socialClicks,
    scrollDepth:         cur.scrollDepth,
    referrers:           cur.referrers,
    devices:             cur.devices,
    inquiryDow:          dowCounts,
    topCities:           cur.topCities,
    topStates:           cur.topStates,
    topCountries:        cur.topCountries,
    avgGuestCount,
    avgDealValue,
    guestBuckets,
    leadSources,
    eventMonths,
    valueBuckets,
    timelines,
  };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date().toISOString();
  const { data: venues, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, report_schedule_emails, report_schedule_next_at')
    .eq('report_schedule_enabled', true)
    .lte('report_schedule_next_at', now)
    .not('report_schedule_next_at', 'is', null);

  if (error) {
    console.error('[booking-report cron] query error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type VenueRow = { id: string; name: string; report_schedule_emails: string[]; report_schedule_next_at: string };
  const rows = (venues ?? []) as VenueRow[];

  let sent = 0, failed = 0;

  for (const venue of rows) {
    const emails = (venue.report_schedule_emails ?? []).filter(e => e.includes('@'));
    if (!emails.length) continue;

    try {
      const reportData = await buildReportForVenue(venue.id, venue.name);
      const html = buildBookingReportHtml(reportData);

      const results = await Promise.all(
        emails.map(to => sendEmail({
          to,
          subject: `Bride Booking System™ Report — ${reportData.periodLabel} | ${reportData.venueName}`,
          html,
        }))
      );

      if (results.every(r => r.success)) {
        const prev = new Date(venue.report_schedule_next_at).getTime();
        const nextAt = new Date(prev + 30 * 86_400_000).toISOString();
        await supabaseAdmin
          .from('venues')
          .update({ report_schedule_next_at: nextAt } as Record<string, unknown>)
          .eq('id', venue.id);
        sent++;
      } else {
        failed++;
        console.warn(`[booking-report cron] partial failure for venue ${venue.id}`);
      }
    } catch (e) {
      failed++;
      console.error(`[booking-report cron] error for venue ${venue.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, processed: rows.length, sent, failed });
}
