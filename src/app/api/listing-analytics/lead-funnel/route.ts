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
    const fromDate = new Date(fromParam + 'T00:00:00Z');
    const toDate = new Date(toParam + 'T23:59:59.999Z');
    since = fromDate.toISOString();
    until = toDate.toISOString();
    days = 1; // Just to trigger the gte/lte logic
  } else {
    days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
    since = new Date(Date.now() - days * 86400000).toISOString();
  }

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

  const stageById = buildStageById((stages ?? []) as LeadFunnelStageRow[]);

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
