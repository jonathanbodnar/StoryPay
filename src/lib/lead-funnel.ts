/**
 * Shared, venue-agnostic lead-funnel bucketing helpers.
 *
 * Buckets a lead's pipeline stage into one of 5 milestones:
 *   1 = Lead, 2 = Conversations Started, 3 = Qualified, 4 = Booked Tours,
 *   5 = Booked Weddings
 *
 * Extracted from src/app/api/listing-analytics/lead-funnel/route.ts (the
 * venue-facing Bride Booking System funnel) so the exact same bucketing +
 * cumulative-count/step-conversion math can be reused by cohort-level admin
 * analytics (see src/app/api/admin/support/cohort-funnels/route.ts) and the
 * monthly booking report (src/lib/booking-report-data.ts) without
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
  /** Origin of the lead. 'contact' rows are synthesized from imported CRM
   *  contacts (GHL sync / kanban reconcile) and don't count until the contact
   *  genuinely engages with us post-import. */
  source?: string | null;
  /** True when the lead was brought in via the GHL migration wizard. */
  is_ghl_migration?: boolean | null;
  /** Last time the contact replied to us (inbound message). */
  last_inbound_at?: string | null;
  /** For imported contacts this is the import/sync timestamp. */
  created_at?: string | null;
}

/** Which of the 5 funnel milestones a lead has reached, and whether it's lost. */
export function leadRank(
  status: string,
  stage: LeadFunnelStageInfo | undefined,
): { rank: 1 | 2 | 3 | 4 | 5; lost: boolean } {
  const name = (stage?.name ?? '').toLowerCase();
  const kind = stage?.kind ?? '';
  const lost = kind === 'lost' || status === 'not_interested';
  const won = kind === 'won' || status === 'booked_wedding';

  if (won) return { rank: 5, lost: false };
  if (name.includes('tour') || name.includes('proposal') || status === 'tour_booked' || status === 'proposal_sent') {
    return { rank: 4, lost };
  }
  if (name.includes('qualified')) {
    return { rank: 3, lost };
  }
  if (name.includes('conversation') || name.includes('contacted') || name.includes('follow up') || status === 'contacted') {
    return { rank: 2, lost };
  }
  return { rank: 1, lost };
}

/**
 * True when a lead is a bulk-imported CRM contact that hasn't genuinely engaged
 * with us since we started tracking it — and therefore should NOT count in the
 * funnel/dashboard. It should exist only as a reference contact.
 *
 * Imported contacts (source='contact' from GHL contact sync / kanban reconcile,
 * or is_ghl_migration from the migration wizard) come over with `created_at` set
 * to the import time and often a mapped pipeline stage — so keying off the stage
 * would count history that predates our tracking. Instead we require a genuine
 * post-import signal:
 *   - the contact REPLIED to us after import (last_inbound_at > created_at), or
 *   - the lead reached a "won"/booked-wedding stage (never hide a real booking).
 *
 * A reply that was carried over from CRM history (last_inbound_at <= created_at)
 * does NOT count, matching "only count data since we tracked it".
 */
export function isUnworkedImportedContact(
  row: LeadFunnelLeadRow,
  stageById: Map<string, LeadFunnelStageInfo>,
): boolean {
  const imported = row.source === 'contact' || row.is_ghl_migration === true;
  if (!imported) return false;

  // A booked wedding is always real — never hide it, even if the reply history
  // wasn't captured.
  const { rank } = leadRank(
    row.status ?? 'new',
    row.stage_id ? stageById.get(row.stage_id) : undefined,
  );
  if (rank >= 5) return false;

  const inbound = row.last_inbound_at ? new Date(row.last_inbound_at).getTime() : NaN;
  const created = row.created_at ? new Date(row.created_at).getTime() : NaN;
  const repliedAfterImport =
    Number.isFinite(inbound) && (!Number.isFinite(created) || inbound > created);

  return !repliedAfterImport;
}

export type LeadFunnelStepKey = 'leads' | 'conversations' | 'qualified' | 'tours' | 'weddings';

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
  { key: 'qualified', label: 'Qualified' },
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
 * Cumulative 5-step funnel (Leads → Conversations Started → Qualified →
 * Booked Tours → Booked Weddings) + step-to-step conversion %, for one set
 * of leads (one venue's leads, or any other pre-scoped slice).
 */
export function computeLeadFunnel(
  leads: LeadFunnelLeadRow[],
  stageById: Map<string, LeadFunnelStageInfo>,
): LeadFunnelShape {
  let leadsCount = 0;
  let conversations = 0;
  let qualified = 0;
  let tours = 0;
  let weddings = 0;

  for (const row of leads) {
    if (isUnworkedImportedContact(row, stageById)) continue;
    leadsCount += 1;
    const { rank, lost } = leadRank(row.status ?? 'new', row.stage_id ? stageById.get(row.stage_id) : undefined);
    if (rank >= 5) weddings += 1;
    if (rank >= 4 && !lost) tours += 1;
    if (rank >= 3 && !lost) qualified += 1;
    if (rank >= 2 && !lost) conversations += 1;
  }

  const steps: LeadFunnelStep[] = [
    { key: 'leads', label: STEP_DEFS[0].label, count: leadsCount },
    { key: 'conversations', label: STEP_DEFS[1].label, count: conversations },
    { key: 'qualified', label: STEP_DEFS[2].label, count: qualified },
    { key: 'tours', label: STEP_DEFS[3].label, count: tours },
    { key: 'weddings', label: STEP_DEFS[4].label, count: weddings },
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
