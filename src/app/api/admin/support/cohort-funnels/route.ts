/**
 * GET /api/admin/support/cohort-funnels
 *
 * Powers the "Support Analytics" admin tab's "Funnel Health by Plan Type"
 * section: the venue-facing lead funnel (Leads → Conversations Started →
 * Qualified → Booked Tours → Booked Weddings), aggregated across 3 venue
 * cohorts:
 *
 *   private_client  venues.is_private_client = true
 *   all_inclusive   directory_plans.slug = 'all-inclusive' AND is_private_client = false
 *   saas_97         directory_plans.slug = 'bride-booking-system' AND is_private_client = false
 *
 * Each cohort's funnel is computed by running every venue's leads through the
 * shared src/lib/lead-funnel.ts helper (the exact same bucketing math the
 * venue-facing dashboard uses) and then summing the per-venue funnels — NOT
 * averaging per-venue percentages (see aggregateLeadFunnels).
 *
 * Query params:
 *   from, to           YYYY-MM-DD lead-created-at window (inclusive)
 *   cohort, stage      when BOTH present, returns a drill-down venue list
 *                      instead of the cohort summary — e.g.
 *                      ?cohort=private_client&stage=tours
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';
import {
  buildStageById,
  computeLeadFunnel,
  aggregateLeadFunnels,
  leadRank,
  type LeadFunnelStageRow,
  type LeadFunnelStepKey,
  type LeadFunnelShape,
} from '@/lib/lead-funnel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function verifyAccess(): Promise<boolean> {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin || id.allowedTabs.has('support-analytics');
}

/** Fetch every row for a query in 1000-row pages (PostgREST hard cap). */
async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  const pageSize = 1000;
  const maxRows = 200_000;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await buildQuery(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

type CohortKey = 'private_client' | 'all_inclusive' | 'saas_97';

const COHORT_DEFS: Array<{ key: CohortKey; label: string }> = [
  { key: 'private_client', label: 'Private Clients (Concierge)' },
  { key: 'all_inclusive', label: 'All-Inclusive (No Concierge)' },
  { key: 'saas_97', label: '$97/mo SaaS Plan' },
];
const COHORT_KEY_SET = new Set<string>(COHORT_DEFS.map((c) => c.key));

interface VenueRow {
  id: string;
  name: string | null;
  is_private_client: boolean | null;
  directory_plan_id: string | null;
}
interface LeadRow {
  id: string;
  venue_id: string;
  status: string | null;
  stage_id: string | null;
  opportunity_value: number | string | null;
  source: string | null;
  is_ghl_migration: boolean | null;
  last_inbound_at: string | null;
  created_at: string | null;
}
interface VenueStageRow extends LeadFunnelStageRow {
  venue_id: string;
}

function toNum(v: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

/** Mirrors computeLeadFunnel's per-step inclusion rules (see lib/lead-funnel.ts). */
function reachesStep(rank: 1 | 2 | 3 | 4 | 5, lost: boolean, stepKey: LeadFunnelStepKey): boolean {
  if (stepKey === 'leads') return true;
  if (stepKey === 'conversations') return rank >= 2 && !lost;
  if (stepKey === 'qualified') return rank >= 3 && !lost;
  if (stepKey === 'tours') return rank >= 4 && !lost;
  return rank >= 5; // weddings
}

export async function GET(req: NextRequest) {
  if (!(await verifyAccess())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const fromParam = sp.get('from');
  const toParam = sp.get('to');
  const cohortParam = (sp.get('cohort') || '').trim();
  const stageParam = (sp.get('stage') || '').trim();

  let sinceIso: string | null = null;
  let untilIso: string | null = null;
  if (fromParam) sinceIso = new Date(`${fromParam}T00:00:00.000Z`).toISOString();
  if (toParam) untilIso = new Date(`${toParam}T23:59:59.999Z`).toISOString();

  try {
    const [{ data: planRows }, venues] = await Promise.all([
      supabaseAdmin.from('directory_plans').select('id, slug'),
      fetchAll<VenueRow>((from, to) =>
        supabaseAdmin.from('venues').select('id, name, is_private_client, directory_plan_id').range(from, to),
      ),
    ]);

    const planIdBySlug = new Map<string, string>();
    for (const p of (planRows ?? []) as Array<{ id: string; slug: string }>) planIdBySlug.set(p.slug, p.id);
    const allInclusivePlanId = planIdBySlug.get('all-inclusive') ?? null;
    const saasPlanId = planIdBySlug.get('bride-booking-system') ?? null;

    const cohortVenues: Record<CohortKey, VenueRow[]> = { private_client: [], all_inclusive: [], saas_97: [] };
    for (const v of venues) {
      if (v.is_private_client) {
        cohortVenues.private_client.push(v);
      } else if (allInclusivePlanId && v.directory_plan_id === allInclusivePlanId) {
        cohortVenues.all_inclusive.push(v);
      } else if (saasPlanId && v.directory_plan_id === saasPlanId) {
        cohortVenues.saas_97.push(v);
      }
    }

    const allCohortVenueIds = Array.from(
      new Set([...cohortVenues.private_client, ...cohortVenues.all_inclusive, ...cohortVenues.saas_97].map((v) => v.id)),
    );

    const [leads, stageRows] = await Promise.all([
      fetchAll<LeadRow>((from, to) => {
        let q = supabaseAdmin
          .from('leads')
          .select('id, venue_id, status, stage_id, opportunity_value, source, is_ghl_migration, last_inbound_at, created_at')
          .in('venue_id', allCohortVenueIds.length ? allCohortVenueIds : ['00000000-0000-0000-0000-000000000000']);
        if (sinceIso) q = q.gte('created_at', sinceIso);
        if (untilIso) q = q.lte('created_at', untilIso);
        return q.range(from, to);
      }),
      fetchAll<VenueStageRow>((from, to) =>
        supabaseAdmin.from('lead_pipeline_stages').select('id, venue_id, name, kind, position').range(from, to),
      ),
    ]);

    const leadsByVenue = new Map<string, LeadRow[]>();
    for (const l of leads) {
      const arr = leadsByVenue.get(l.venue_id) ?? [];
      arr.push(l);
      leadsByVenue.set(l.venue_id, arr);
    }
    const stagesByVenue = new Map<string, VenueStageRow[]>();
    for (const s of stageRows) {
      const arr = stagesByVenue.get(s.venue_id) ?? [];
      arr.push(s);
      stagesByVenue.set(s.venue_id, arr);
    }

    // ── Drill-down branch: venues in a cohort at/past a given stage ─────────
    if (cohortParam && COHORT_KEY_SET.has(cohortParam) && stageParam) {
      const cohortKey = cohortParam as CohortKey;
      const validStages: LeadFunnelStepKey[] = ['leads', 'conversations', 'qualified', 'tours', 'weddings'];
      if (!(validStages as string[]).includes(stageParam)) {
        return NextResponse.json({ error: 'Invalid stage' }, { status: 400 });
      }
      const stageKey = stageParam as LeadFunnelStepKey;

      const drillVenues = cohortVenues[cohortKey].map((v) => {
        const venueLeads = leadsByVenue.get(v.id) ?? [];
        const stageById = buildStageById(stagesByVenue.get(v.id) ?? []);
        let countAtOrPast = 0;
        for (const l of venueLeads) {
          const { rank, lost } = leadRank(l.status ?? 'new', l.stage_id ? stageById.get(l.stage_id) : undefined);
          if (reachesStep(rank, lost, stageKey)) countAtOrPast += 1;
        }
        return {
          id: v.id,
          name: v.name || 'Untitled venue',
          leadCount: venueLeads.length,
          countAtOrPastStage: countAtOrPast,
        };
      }).filter((v) => v.countAtOrPastStage > 0)
        .sort((a, b) => b.countAtOrPastStage - a.countAtOrPastStage);

      return NextResponse.json({ cohort: cohortKey, stage: stageKey, venues: drillVenues });
    }

    // ── Cohort summary branch ────────────────────────────────────────────────
    const cohorts = COHORT_DEFS.map(({ key, label }) => {
      const vList = cohortVenues[key];
      const perVenueShapes: LeadFunnelShape[] = [];
      let totalBookedValue = 0;
      for (const v of vList) {
        const venueLeads = leadsByVenue.get(v.id) ?? [];
        const stageById = buildStageById(stagesByVenue.get(v.id) ?? []);
        perVenueShapes.push(computeLeadFunnel(venueLeads, stageById));
        for (const l of venueLeads) {
          const { rank } = leadRank(l.status ?? 'new', l.stage_id ? stageById.get(l.stage_id) : undefined);
          if (rank >= 4) totalBookedValue += toNum(l.opportunity_value);
        }
      }
      const shape = aggregateLeadFunnels(perVenueShapes.length ? perVenueShapes : [{ steps: [
        { key: 'leads', label: 'Leads', count: 0 },
        { key: 'conversations', label: 'Conversations Started', count: 0 },
        { key: 'qualified', label: 'Qualified', count: 0 },
        { key: 'tours', label: 'Booked Tours', count: 0 },
        { key: 'weddings', label: 'Booked Weddings', count: 0 },
      ], conversions: [null, null, null, null] }]);

      const leadsCount = shape.steps[0]?.count ?? 0;
      const wonCount = shape.steps.find((s) => s.key === 'weddings')?.count ?? 0;
      const leadToWonPct = leadsCount > 0 ? Math.round((wonCount / leadsCount) * 1000) / 10 : null;

      // Biggest drop-off: largest absolute count drop between consecutive steps.
      let biggestDropOff: { fromLabel: string; toLabel: string; dropCount: number; stepConversion: number | null } | null = null;
      for (let i = 1; i < shape.steps.length; i++) {
        const drop = shape.steps[i - 1].count - shape.steps[i].count;
        if (drop > 0 && (!biggestDropOff || drop > biggestDropOff.dropCount)) {
          biggestDropOff = {
            fromLabel: shape.steps[i - 1].label,
            toLabel: shape.steps[i].label,
            dropCount: drop,
            stepConversion: shape.conversions[i - 1],
          };
        }
      }

      return {
        key,
        label,
        venueCount: vList.length,
        steps: shape.steps,
        conversions: shape.conversions,
        leadToWonPct,
        biggestDropOff,
        totalBookedValue: Math.round(totalBookedValue * 100) / 100,
      };
    });

    return NextResponse.json({ cohorts, window: { from: fromParam, to: toParam } });
  } catch (err) {
    console.error('[cohort-funnels] query failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load cohort funnels' },
      { status: 500 },
    );
  }
}
