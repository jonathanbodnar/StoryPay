import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureDefaultPipeline, effectiveWinProbability, loadPipelinesWithStages } from '@/lib/pipelines';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * GET /api/leads/insights?pipeline_id=<optional>
 * Weighted pipeline, per-stage breakdown, rough revenue by referral_source, listing ROI hint.
 */
export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pipelineIdParam = request.nextUrl.searchParams.get('pipeline_id');
  await ensureDefaultPipeline(venueId);

  const pipelines = await loadPipelinesWithStages(venueId);
  const pipelineId =
    pipelineIdParam && pipelines.some((p) => p.id === pipelineIdParam)
      ? pipelineIdParam
      : pipelines.find((p) => p.is_default)?.id ?? pipelines[0]?.id ?? null;

  if (!pipelineId) {
    return NextResponse.json({
      pipelineId: null,
      totals: { raw: 0, weighted: 0, count: 0 },
      byStage: [],
      referralRevenue: [],
      directoryAttributedRevenue: 0,
      listingBudget: null as number | null,
      roiVsListing: null as number | null,
    });
  }

  const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];
  const stageById = new Map(stages.map((s) => [s.id, s]));

  const { data: leadRows } = await supabaseAdmin
    .from('leads')
    .select('id, email, opportunity_value, stage_id, referral_source, source, status')
    .eq('venue_id', venueId)
    .eq('pipeline_id', pipelineId);

  const leads = leadRows ?? [];

  let raw = 0;
  let weighted = 0;
  const byStageMap = new Map<
    string,
    { stageId: string; name: string; raw: number; weighted: number; count: number; winPct: number }
  >();

  for (const s of stages) {
    byStageMap.set(s.id, {
      stageId: s.id,
      name: s.name,
      raw: 0,
      weighted: 0,
      count: 0,
      winPct: effectiveWinProbability(s),
    });
  }

  for (const l of leads as Array<{ opportunity_value: number | null; stage_id: string | null }>) {
    const v = l.opportunity_value != null ? Number(l.opportunity_value) : 0;
    if (Number.isNaN(v)) continue;
    raw += v;
    const st = l.stage_id ? stageById.get(l.stage_id) : undefined;
    const win = st ? effectiveWinProbability(st) : 25;
    weighted += (v * win) / 100;
    const bucket = l.stage_id && byStageMap.has(l.stage_id) ? byStageMap.get(l.stage_id)! : null;
    if (bucket) {
      bucket.raw += v;
      bucket.weighted += (v * win) / 100;
      bucket.count += 1;
    }
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('listing_marketing_monthly_spend')
    .eq('id', venueId)
    .maybeSingle();

  const listingBudget =
    venue && (venue as { listing_marketing_monthly_spend?: number | null }).listing_marketing_monthly_spend != null
      ? Number((venue as { listing_marketing_monthly_spend?: number }).listing_marketing_monthly_spend)
      : null;

  const { data: paidProposals } = await supabaseAdmin
    .from('proposals')
    .select('customer_email, price, status')
    .eq('venue_id', venueId)
    .eq('status', 'paid');

  const emailToReferral = new Map<string, string>();
  for (const l of leads as Array<{ email: string; referral_source: string | null }>) {
    const k = (l.email || '').trim().toLowerCase();
    if (!k) continue;
    const ref = (l.referral_source || '').trim() || '(none)';
    emailToReferral.set(k, ref);
  }

  const revenueByRef = new Map<string, number>();
  let directoryAttributed = 0;

  for (const p of paidProposals ?? []) {
    const row = p as { customer_email: string | null; price: number | null };
    const email = (row.customer_email || '').trim().toLowerCase();
    if (!email) continue;
    const price = row.price != null ? Number(row.price) : 0;
    if (Number.isNaN(price)) continue;
    const ref = emailToReferral.get(email) ?? '(unmatched lead)';
    revenueByRef.set(ref, (revenueByRef.get(ref) ?? 0) + price);

    const leadForEmail = (leads as Array<{ email: string; source: string }>).find(
      (x) => (x.email || '').trim().toLowerCase() === email,
    );
    if (leadForEmail?.source === 'directory') directoryAttributed += price;
  }

  const referralRevenue = [...revenueByRef.entries()]
    .map(([referralLabel, revenue]) => ({ referralLabel, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const roiVsListing =
    listingBudget && listingBudget > 0 ? directoryAttributed / listingBudget : null;

  return NextResponse.json({
    pipelineId,
    totals: {
      raw,
      weighted,
      count: leads.length,
    },
    byStage: [...byStageMap.values()].filter((s) => s.count > 0 || stages.some((x) => x.id === s.stageId)),
    referralRevenue,
    directoryAttributedRevenue: directoryAttributed,
    listingBudget,
    roiVsListing,
  });
}
