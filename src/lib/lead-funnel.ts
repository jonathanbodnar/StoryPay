/**
 * Shared, venue-agnostic lead-funnel bucketing helpers.
 *
 * Buckets a lead's pipeline stage into one of 4 milestones:
 *   1 = Lead, 2 = Conversations Started, 3 = Booked Tours, 4 = Booked Weddings
 *
 * Extracted from src/app/api/listing-analytics/lead-funnel/route.ts (the
 * venue-facing Bride Booking System funnel) so the exact same bucketing +
 * cumulative-count/step-conversion math can be reused by cohort-level admin
 * analytics (see src/app/api/admin/support/cohort-funnels/route.ts) without
 * duplicating the logic. Pure functions — no Supabase calls, no I/O.
 */

export interface LeadFunnelStageInfo {
  name: string;
  kind: string;
  position: number;
}

export interface LeadFunnelStageRow extends LeadFunnelStageInfo {
  id: string;
}

export interface LeadFunnelLeadRow {
  status: string | null;
  stage_id: string | null;
}

/** Which of the 4 funnel milestones a lead has reached, and whether it's lost. */
export function leadRank(
  status: string,
  stage: LeadFunnelStageInfo | undefined,
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

export type LeadFunnelStepKey = 'leads' | 'conversations' | 'tours' | 'weddings';

export interface LeadFunnelStep {
  key: LeadFunnelStepKey;
  label: string;
  count: number;
}

export interface LeadFunnelShape {
  steps: LeadFunnelStep[];
  /** Step-to-step conversion %, aligned with steps.slice(1) (one entry per step after the first). */
  conversions: (number | null)[];
}

const STEP_DEFS: Array<{ key: LeadFunnelStepKey; label: string }> = [
  { key: 'leads', label: 'Leads' },
  { key: 'conversations', label: 'Conversations Started' },
  { key: 'tours', label: 'Booked Tours' },
  { key: 'weddings', label: 'Booked Weddings' },
];

/** Build a stage-by-id lookup map from a flat stages array (one venue's stages). */
export function buildStageById(stages: LeadFunnelStageRow[]): Map<string, LeadFunnelStageInfo> {
  return new Map(stages.map((s) => [s.id, { name: s.name, kind: s.kind, position: s.position }]));
}

function conversionsFromSteps(steps: LeadFunnelStep[]): (number | null)[] {
  return steps.slice(1).map((step, i) => {
    const from = steps[i].count;
    return from > 0 ? Math.round((step.count / from) * 100) : null;
  });
}

/**
 * Cumulative 4-step funnel (Leads → Conversations Started → Booked Tours →
 * Booked Weddings) + step-to-step conversion %, for one set of leads (one
 * venue's leads, or any other pre-scoped slice).
 */
export function computeLeadFunnel(
  leads: LeadFunnelLeadRow[],
  stageById: Map<string, LeadFunnelStageInfo>,
): LeadFunnelShape {
  let leadsCount = 0;
  let conversations = 0;
  let tours = 0;
  let weddings = 0;

  for (const row of leads) {
    leadsCount += 1;
    const { rank, lost } = leadRank(row.status ?? 'new', row.stage_id ? stageById.get(row.stage_id) : undefined);
    if (rank >= 4) weddings += 1;
    if (rank >= 3 && !lost) tours += 1;
    if (rank >= 2 && !lost) conversations += 1;
  }

  const steps: LeadFunnelStep[] = [
    { key: 'leads', label: STEP_DEFS[0].label, count: leadsCount },
    { key: 'conversations', label: STEP_DEFS[1].label, count: conversations },
    { key: 'tours', label: STEP_DEFS[2].label, count: tours },
    { key: 'weddings', label: STEP_DEFS[3].label, count: weddings },
  ];

  return { steps, conversions: conversionsFromSteps(steps) };
}

/**
 * Sum multiple already-computed funnels (e.g. one per venue in a cohort) into
 * a single funnel, then recompute step-conversion % from the summed counts
 * (NOT an average of the per-venue percentages).
 */
export function aggregateLeadFunnels(shapes: LeadFunnelShape[]): LeadFunnelShape {
  const totals = new Map<LeadFunnelStepKey, number>(STEP_DEFS.map((s) => [s.key, 0]));
  for (const shape of shapes) {
    for (const step of shape.steps) {
      totals.set(step.key, (totals.get(step.key) ?? 0) + step.count);
    }
  }
  const steps: LeadFunnelStep[] = STEP_DEFS.map((s) => ({ key: s.key, label: s.label, count: totals.get(s.key) ?? 0 }));
  return { steps, conversions: conversionsFromSteps(steps) };
}
