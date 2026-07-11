import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  bucketLeadSource,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCE_ORDER,
  type LeadSourceBucket,
} from '@/lib/lead-source';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/listing-analytics/lead-funnel
 *
 * Powers the "Bride Booking System" dashboard funnel: a cumulative count of
 * how far leads have progressed through the booking journey. Milestones map
 * onto the venue's pipeline stages (see DEFAULT_STAGE_TEMPLATE):
 *
 *   Leads → Conversations Started → Booked Tours → Booked Weddings
 *
 * The funnel is cumulative — a lead that booked a wedding is counted in every
 * earlier milestone too. Lost leads (kind="lost" / status="not_interested")
 * still count as a Lead but are excluded from the progressed milestones.
 *
 * Always live: the client polls this on the same 30s cadence as the realtime
 * panel so the numbers stay current without a manual refresh.
 *
 * Source attribution: every lead is bucketed into Meta / Google / Direct /
 * Other (see lib/lead-source). The response always includes a `sources`
 * breakdown of the whole date range so the dashboard can show where leads came
 * from, and an optional `?source=` filter re-runs the entire funnel over just
 * the leads from that one source.
 */

type StageInfo = { name: string; kind: string; position: number };

function leadRank(
  status: string,
  stage: StageInfo | undefined,
): { rank: 1 | 2 | 3 | 4; lost: boolean } {
  const name = (stage?.name ?? '').toLowerCase();
  const kind = stage?.kind ?? '';
  const lost = kind === 'lost' || status === 'not_interested';
  const won = kind === 'won' || status === 'booked_wedding';

  if (won) return { rank: 4, lost: false };
  if (name.includes('tour') || name.includes('proposal') || status === 'tour_booked' || status === 'proposal_sent') {
    return { rank: 3, lost };
  }
  if (name.includes('conversation') || name.includes('contacted') || name.includes('follow up') || status === 'contacted') {
    return { rank: 2, lost };
  }
  return { rank: 1, lost };
}

export async function GET(req: Request) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  const sourceParam = url.searchParams.get('source');
  const sourceFilter: LeadSourceBucket | null =
    sourceParam && LEAD_SOURCE_ORDER.includes(sourceParam as LeadSourceBucket)
      ? (sourceParam as LeadSourceBucket)
      : null;
  
  let since = '';
  let until = '';
  let days = 30;

  if (fromParam && toParam) {
    const fromDate = new Date(fromParam + 'T00:00:00Z');
    const toDate = new Date(toParam + 'T23:59:59.999Z');
    since = fromDate.toISOString();
    until = toDate.toISOString();
    days = 1; // Just to trigger the gte/lte logic
  } else {
    days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
    since = new Date(Date.now() - days * 86400000).toISOString();
  }
  // Visitor counting needs a bounded window on both ends.
  if (!until) until = new Date().toISOString();

  let leadsQuery = supabaseAdmin
    .from('leads')
    .select('id, status, stage_id, first_touch_utm, source, referral_source')
    .eq('venue_id', venueId);
    
  if (days > 0) {
    leadsQuery = leadsQuery.gte('created_at', since);
  }
  if (until) {
    leadsQuery = leadsQuery.lte('created_at', until);
  }

  const [{ data: leads }, { data: stages }] = await Promise.all([
    leadsQuery.limit(5000),
    supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name, kind, position')
      .eq('venue_id', venueId),
  ]);

  const stageById = new Map<string, StageInfo>(
    ((stages ?? []) as Array<{ id: string; name: string; kind: string; position: number }>).map((s) => [
      s.id,
      { name: s.name, kind: s.kind, position: s.position },
    ]),
  );

  let leadsCount = 0;
  let conversations = 0;
  let tours = 0;
  let weddings = 0;

  // Per-source lead tallies for the whole range (unaffected by the active
  // filter) so the dashboard can render the "where leads came from" breakdown.
  const sourceCounts: Record<LeadSourceBucket, number> = { meta: 0, google: 0, direct: 0, other: 0 };

  type LeadRow = {
    status: string;
    stage_id: string | null;
    first_touch_utm: Record<string, unknown> | null;
    source: string | null;
    referral_source: string | null;
  };

  for (const row of (leads ?? []) as LeadRow[]) {
    const bucket = bucketLeadSource({
      first_touch_utm: row.first_touch_utm,
      source: row.source,
      referral_source: row.referral_source,
    });
    sourceCounts[bucket] += 1;

    // When a source filter is active, only that source's leads flow through
    // the funnel math — every step and conversion % reflects just that slice.
    if (sourceFilter && bucket !== sourceFilter) continue;

    leadsCount += 1;
    const { rank, lost } = leadRank(row.status ?? 'new', row.stage_id ? stageById.get(row.stage_id) : undefined);
    if (rank >= 4) weddings += 1;
    if (rank >= 3 && !lost) tours += 1;
    if (rank >= 2 && !lost) conversations += 1;
  }

  const sources = LEAD_SOURCE_ORDER.map((key) => ({
    key,
    label: LEAD_SOURCE_LABELS[key],
    count: sourceCounts[key],
  }));

  // ── Visitors (top of funnel) ──────────────────────────────────────────
  // Unique listing-page sessions in the same window, bucketed by the SAME
  // source logic (utm + referrer). This becomes the leftmost funnel step so
  // the owner can see traffic → lead conversion. Counted independently of the
  // leads table (a session can't be hard-linked to a lead), so visitors → leads
  // is a same-window approximation, like every other step here.
  const visitorSessions = new Map<string, LeadSourceBucket>();
  try {
    const PAGE = 1000;
    const MAX_PAGES = 60;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabaseAdmin
        .from('listing_events')
        .select('session_id, utm_source, utm_medium, utm_campaign, referrer')
        .eq('venue_id', venueId)
        .eq('event_type', 'page_view')
        .gte('created_at', since)
        .lte('created_at', until)
        .order('created_at', { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) break; // table missing / query failed → treat as zero visitors
      const batch = (data ?? []) as Array<{
        session_id: string;
        utm_source: string | null;
        utm_medium: string | null;
        utm_campaign: string | null;
        referrer: string | null;
      }>;
      for (const row of batch) {
        if (!row.session_id || visitorSessions.has(row.session_id)) continue;
        const bucket = bucketLeadSource({
          first_touch_utm: {
            utm_source: row.utm_source ?? undefined,
            utm_medium: row.utm_medium ?? undefined,
            utm_campaign: row.utm_campaign ?? undefined,
            referrer: row.referrer ?? undefined,
          },
        });
        visitorSessions.set(row.session_id, bucket);
      }
      if (batch.length < PAGE) break;
    }
  } catch { /* no visitor data — visitors step shows 0 */ }

  let visitorsCount = 0;
  for (const bucket of visitorSessions.values()) {
    if (sourceFilter && bucket !== sourceFilter) continue;
    visitorsCount += 1;
  }

  const steps = [
    { key: 'visitors', label: 'Listing Visitors', count: visitorsCount },
    { key: 'leads', label: 'Leads', count: leadsCount },
    { key: 'conversations', label: 'Conversations Started', count: conversations },
    { key: 'tours', label: 'Booked Tours', count: tours },
    { key: 'weddings', label: 'Booked Weddings', count: weddings },
  ];

  // Conversion % between each consecutive milestone (to / from).
  const conversions = steps.slice(1).map((step, i) => {
    const from = steps[i].count;
    return from > 0 ? Math.round((step.count / from) * 100) : null;
  });

  return NextResponse.json({ steps, conversions, sources, source: sourceFilter });
}
