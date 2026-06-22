import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '90', 10), 365);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [{ data: leads }, { data: stages }] = await Promise.all([
    supabaseAdmin
      .from('leads')
      .select('guest_count, wedding_date, source, booking_timeline, opportunity_value, referral_source, created_at, status, stage_id')
      .eq('venue_id', venueId)
      .gte('created_at', since),
    supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name, kind, position')
      .eq('venue_id', venueId),
  ]);

  const rows = leads ?? [];

  const stageById = new Map<string, { name: string; kind: string; position: number }>(
    ((stages ?? []) as Array<{ id: string; name: string; kind: string; position: number }>).map((s) => [
      s.id,
      { name: s.name, kind: s.kind, position: s.position },
    ]),
  );

  function isBookedWedding(status: string | null, stageId: string | null) {
    const stage = stageId ? stageById.get(stageId) : undefined;
    const kind = stage?.kind ?? '';
    return kind === 'won' || status === 'booked_wedding';
  }

  // ── Guest count buckets ───────────────────────────────────────────────────
  const guestBuckets: Record<string, number> = {
    '1–50':    0,
    '51–100':  0,
    '101–150': 0,
    '151–200': 0,
    '201–300': 0,
    '300+':    0,
    'Not set': 0,
  };
  for (const r of rows) {
    const g = r.guest_count;
    if (g == null)  { guestBuckets['Not set']++;   continue; }
    if (g <= 50)    { guestBuckets['1–50']++;       continue; }
    if (g <= 100)   { guestBuckets['51–100']++;     continue; }
    if (g <= 150)   { guestBuckets['101–150']++;    continue; }
    if (g <= 200)   { guestBuckets['151–200']++;    continue; }
    if (g <= 300)   { guestBuckets['201–300']++;    continue; }
    guestBuckets['300+']++;
  }

  // ── Lead sources ─────────────────────────────────────────────────────────
  const sourceMap: Record<string, number> = {};
  for (const r of rows) {
    const s = r.source || 'Unknown';
    sourceMap[s] = (sourceMap[s] ?? 0) + 1;
  }
  const sources = Object.entries(sourceMap).sort(([,a],[,b])=>b-a).slice(0,8).map(([source,count])=>({source,count}));

  // ── Event month distribution (when are they getting married) ─────────────
  const monthMap: Record<string, number> = {};
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (const r of rows) {
    if (!r.wedding_date) continue;
    const m = new Date(r.wedding_date + 'T00:00:00').getMonth();
    const label = MONTHS[m];
    if (label) monthMap[label] = (monthMap[label] ?? 0) + 1;
  }
  const eventMonths = MONTHS.map(m => ({ month: m, count: monthMap[m] ?? 0 }));

  // ── Opportunity value ranges ──────────────────────────────────────────────
  const valueBuckets: Record<string, number> = {
    'Not set': 0,
    '<$1k':    0,
    '$1k–$5k': 0,
    '$5k–$10k':0,
    '$10k–$20k':0,
    '$20k+':   0,
  };
  for (const r of rows) {
    const v = r.opportunity_value;
    if (v == null)         { valueBuckets['Not set']++;   continue; }
    if (v < 1000)        { valueBuckets['<$1k']++;      continue; }
    if (v < 5000)        { valueBuckets['$1k–$5k']++;   continue; }
    if (v < 10000)       { valueBuckets['$5k–$10k']++;  continue; }
    if (v < 20000)       { valueBuckets['$10k–$20k']++; continue; }
    valueBuckets['$20k+']++;
  }

  // ── Booking timeline distribution ─────────────────────────────────────────
  const timelineMap: Record<string, number> = {};
  for (const r of rows) {
    const t = r.booking_timeline || 'Unknown';
    timelineMap[t] = (timelineMap[t] ?? 0) + 1;
  }
  const timelines = Object.entries(timelineMap).sort(([,a],[,b])=>b-a).map(([label,count])=>({label,count}));

  // ── Monthly lead volume trend ─────────────────────────────────────────────
  const trendMap: Record<string, number> = {};
  for (const r of rows) {
    const key = r.created_at.slice(0, 7); // YYYY-MM
    trendMap[key] = (trendMap[key] ?? 0) + 1;
  }
  const leadTrend = Object.entries(trendMap).sort(([a],[b])=>a.localeCompare(b)).map(([month,count])=>({month,count}));

  // ── Summary ──────────────────────────────────────────────────────────────
  const avgGuests = rows.filter(r => r.guest_count != null).length
    ? Math.round(rows.filter(r => r.guest_count != null).reduce((s,r) => s + (r.guest_count ?? 0), 0) / rows.filter(r => r.guest_count != null).length)
    : null;

  const bookedLeadsWithValue = rows.filter(r => r.opportunity_value != null && isBookedWedding(r.status, r.stage_id));
  const avgValue = bookedLeadsWithValue.length
    ? Math.round(bookedLeadsWithValue.reduce((s,r) => s + (r.opportunity_value ?? 0), 0) / bookedLeadsWithValue.length)
    : null;

  return NextResponse.json({
    total_leads: rows.length,
    avg_guest_count: avgGuests,
    avg_opportunity_value: avgValue,
    guest_buckets: Object.entries(guestBuckets).filter(([,v])=>v>0).map(([label,count])=>({label,count})),
    sources,
    event_months: eventMonths,
    value_buckets: Object.entries(valueBuckets).filter(([,v])=>v>0).map(([label,count])=>({label,count})),
    timelines,
    lead_trend: leadTrend,
  });
}
