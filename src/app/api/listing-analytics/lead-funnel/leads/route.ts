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
  isUnworkedImportedContact,
  leadRank,
  type LeadFunnelStageRow,
  type LeadFunnelStepKey,
} from '@/lib/lead-funnel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/listing-analytics/lead-funnel/leads?step=tours[&source=meta][&from&to&tzOffset|&days]
 *
 * Companion to the Bride Booking System funnel: returns the actual leads behind
 * one funnel box so the dashboard can pop a modal listing each bride with a link
 * straight to her chat. Semantics MATCH the numbers on the funnel exactly:
 *
 *   - Cumulative: a lead is returned for a step when it has REACHED that step or
 *     beyond (e.g. "Booked Tours" includes brides who then booked weddings), so
 *     the list length equals the count shown on the box.
 *   - Same exclusions: unworked bulk-imported CRM contacts are dropped.
 *   - Same filters: honors the active source filter and the date range.
 */

const STEP_KEYS: LeadFunnelStepKey[] = ['leads', 'conversations', 'qualified', 'tours', 'weddings'];

/** Cumulative membership test for a step — mirrors computeLeadFunnel's increments. */
function reachedStep(step: LeadFunnelStepKey, rank: number, lost: boolean): boolean {
  switch (step) {
    case 'leads':         return true;              // every counted lead
    case 'conversations': return rank >= 2 && !lost;
    case 'qualified':     return rank >= 3 && !lost;
    case 'tours':         return rank >= 4 && !lost;
    case 'weddings':      return rank >= 5;          // won
  }
}

export async function GET(req: Request) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const stepParam = url.searchParams.get('step') as LeadFunnelStepKey | null;
  const step: LeadFunnelStepKey | null = stepParam && STEP_KEYS.includes(stepParam) ? stepParam : null;
  if (!step) return NextResponse.json({ error: 'Invalid or missing step' }, { status: 400 });

  const sourceParam = url.searchParams.get('source');
  const sourceFilter: LeadSourceBucket | null =
    sourceParam && LEAD_SOURCE_ORDER.includes(sourceParam as LeadSourceBucket)
      ? (sourceParam as LeadSourceBucket)
      : null;

  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  let since = '';
  let until = '';
  let days = 30;
  if (fromParam && toParam) {
    const tzOffsetMin = parseInt(url.searchParams.get('tzOffset') || '0', 10);
    const shiftMs = (Number.isFinite(tzOffsetMin) ? tzOffsetMin : 0) * 60_000;
    since = new Date(Date.parse(fromParam + 'T00:00:00.000Z') + shiftMs).toISOString();
    until = new Date(Date.parse(toParam + 'T23:59:59.999Z') + shiftMs).toISOString();
    days = 1;
  } else {
    days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
    since = new Date(Date.now() - days * 86400000).toISOString();
  }

  type LeadRow = {
    id: string;
    status: string;
    stage_id: string | null;
    first_touch_utm: Record<string, unknown> | null;
    source: string | null;
    referral_source: string | null;
    is_ghl_migration: boolean | null;
    last_inbound_at: string | null;
    created_at: string | null;
    first_name: string | null;
    last_name: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
  };

  const PAGE = 1000;
  async function fetchAllLeads(): Promise<LeadRow[]> {
    const out: LeadRow[] = [];
    for (let offset = 0; offset < 200_000; offset += PAGE) {
      let q = supabaseAdmin
        .from('leads')
        .select('id, status, stage_id, first_touch_utm, source, referral_source, is_ghl_migration, last_inbound_at, created_at, first_name, last_name, name, email, phone')
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

  const MAX = 500;
  const items: Array<{
    id: string;
    name: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    stage: string | null;
    source: LeadSourceBucket;
    created_at: string | null;
  }> = [];
  let total = 0;

  for (const row of leads) {
    if (isUnworkedImportedContact(row, stageById)) continue;
    const bucket = bucketLeadSource({
      first_touch_utm: row.first_touch_utm,
      source: row.source,
      referral_source: row.referral_source,
    });
    if (sourceFilter && bucket !== sourceFilter) continue;

    const stageInfo = row.stage_id ? stageById.get(row.stage_id) : undefined;
    const { rank, lost } = leadRank(row.status ?? 'new', stageInfo);
    if (!reachedStep(step, rank, lost)) continue;

    total += 1;
    if (items.length >= MAX) continue;

    const display =
      [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
      (row.name ?? '').trim() ||
      (row.email ?? '').trim() ||
      'Unnamed lead';

    items.push({
      id: row.id,
      name: display,
      first_name: (row.first_name ?? '').trim() || null,
      last_name: (row.last_name ?? '').trim() || null,
      email: (row.email ?? '').trim() || null,
      phone: (row.phone ?? '').trim() || null,
      stage: stageInfo?.name ?? null,
      source: bucket,
      created_at: row.created_at,
    });
  }

  return NextResponse.json({
    step,
    source: sourceFilter,
    total,
    truncated: total > items.length,
    sourceLabels: LEAD_SOURCE_LABELS,
    leads: items,
  });
}
