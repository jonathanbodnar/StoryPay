import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  bucketLeadSource,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCE_ORDER,
  type LeadSourceBucket,
} from '@/lib/lead-source';
import {
  buildStageById,
  computeLeadFunnel,
  isUnworkedImportedContact,
  type LeadFunnelStageRow,
} from '@/lib/lead-funnel';

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
    // The date picker sends the viewer's LOCAL calendar dates (YYYY-MM-DD). Shift
    // the UTC day bounds by the viewer's timezone offset so "Today"/"Last 7 days"
    // reflect the venue's local day, not UTC midnight (which for US venues leaks
    // several hours of the previous/next day into the wrong bucket).
    const tzOffsetMin = parseInt(url.searchParams.get('tzOffset') || '0', 10);
    const shiftMs = (Number.isFinite(tzOffsetMin) ? tzOffsetMin : 0) * 60_000;
    since = new Date(Date.parse(fromParam + 'T00:00:00.000Z') + shiftMs).toISOString();
    until = new Date(Date.parse(toParam + 'T23:59:59.999Z') + shiftMs).toISOString();
    days = 1; // Just to trigger the gte/lte logic
  } else {
    days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
    since = new Date(Date.now() - days * 86400000).toISOString();
  }

  type LeadRow = {
    status: string;
    stage_id: string | null;
    first_touch_utm: Record<string, unknown> | null;
    source: string | null;
    referral_source: string | null;
    is_ghl_migration: boolean | null;
    last_inbound_at: string | null;
    created_at: string | null;
  };

  // Paginate past PostgREST's 1000-row server cap. A single `.limit(5000)` is
  // silently truncated to 1000 rows, and — with no stable order — that slice is
  // arbitrary. For venues with a large imported CRM this made a wider date
  // range return FEWER leads than a narrow one (the truncated slice happened to
  // be dominated by one day's import batch). Fetch every matching row instead.
  const PAGE = 1000;
  async function fetchAllLeads(): Promise<LeadRow[]> {
    const out: LeadRow[] = [];
    for (let offset = 0; offset < 200_000; offset += PAGE) {
      let q = supabaseAdmin
        .from('leads')
        .select('id, status, stage_id, first_touch_utm, source, referral_source, is_ghl_migration, last_inbound_at, created_at')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false });
      if (days > 0) q = q.gte('created_at', since);
      if (until) q = q.lte('created_at', until);
      const { data, error } = await q.range(offset, offset + PAGE - 1);
      if (error || !data?.length) break;
      out.push(...(data as LeadRow[]));
      if (data.length < PAGE) break;
    }
    return out;
  }

  const [leads, { data: stages }] = await Promise.all([
    fetchAllLeads(),
    supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name, kind, position')
      .eq('venue_id', venueId),
  ]);

  const stageById = buildStageById((stages ?? []) as LeadFunnelStageRow[]);

  // Per-source lead tallies for the whole range (unaffected by the active
  // filter) so the dashboard can render the "where leads came from" breakdown.
  const sourceCounts: Record<LeadSourceBucket, number> = { meta: 0, google: 0, webform: 0, direct: 0, other: 0 };

  // When a source filter is active, only that source's leads flow through
  // the funnel math — every step and conversion % reflects just that slice.
  const filteredLeads: LeadRow[] = [];
  for (const row of (leads ?? []) as LeadRow[]) {
    // Bulk-imported CRM contacts that were never worked are not genuine
    // inquiries — exclude them from both the source breakdown and the funnel.
    if (isUnworkedImportedContact(row, stageById)) continue;
    const bucket = bucketLeadSource({
      first_touch_utm: row.first_touch_utm,
      source: row.source,
      referral_source: row.referral_source,
    });
    sourceCounts[bucket] += 1;
    if (sourceFilter && bucket !== sourceFilter) continue;
    filteredLeads.push(row);
  }

  const sources = LEAD_SOURCE_ORDER.map((key) => ({
    key,
    label: LEAD_SOURCE_LABELS[key],
    count: sourceCounts[key],
  }));

  const { steps, conversions } = computeLeadFunnel(filteredLeads, stageById);

  return NextResponse.json({ steps, conversions, sources, source: sourceFilter });
}
