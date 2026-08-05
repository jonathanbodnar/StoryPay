/**
 * Shared "Mark Qualified" toggle logic used by both the venue-owner pill
 * (src/app/api/leads/[id]/toggle-qualified/route.ts) and the concierge/admin
 * pill (the `toggle_qualified` action on
 * src/app/api/admin/support/bride-thread/[threadId]/action/route.ts).
 *
 * One click moves a lead into the venue's default-pipeline "Qualified"
 * stage; a second click moves it back to "Conversations Started" — always
 * that specific stage on toggle-off, never "whatever it was before". Reuses
 * the same rank buckets as lib/lead-funnel.ts so "already past Qualified"
 * (Tour Booked / Proposal Sent / Wedding Booked) is defined in exactly one
 * place and enforced server-side, not just hidden in the UI.
 *
 * Deliberately decoupled from the pre-existing `qualified` system tag in
 * lib/system-tags.ts — this never reads or writes that tag.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { legacyStatusForStageName } from '@/lib/pipelines';
import { leadRank, type LeadFunnelStageInfo } from '@/lib/lead-funnel';

export type ToggleQualifiedResult =
  | {
      ok: true;
      /** True when the lead is now in the Qualified stage; false when moved back to Conversations Started. */
      qualified: boolean;
      previousStageId: string | null;
      stage: { id: string; name: string; color: string | null; pipeline_id: string };
      leadEmail: string | null;
    }
  | { ok: false; status: number; error: string };

export async function toggleLeadQualified(venueId: string, leadId: string): Promise<ToggleQualifiedResult> {
  const { data: leadRow, error: leadErr } = await supabaseAdmin
    .from('leads')
    .select('id, status, stage_id, pipeline_id, email')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (leadErr) return { ok: false, status: 500, error: leadErr.message };
  if (!leadRow) return { ok: false, status: 404, error: 'Lead not found' };

  const lead = leadRow as {
    id: string; status: string | null; stage_id: string | null; pipeline_id: string | null; email: string | null;
  };

  const { data: pipelineRow } = await supabaseAdmin
    .from('lead_pipelines')
    .select('id')
    .eq('venue_id', venueId)
    .eq('is_default', true)
    .maybeSingle();
  const defaultPipelineId = (pipelineRow as { id: string } | null)?.id ?? null;
  if (!defaultPipelineId) {
    return { ok: false, status: 500, error: 'No default pipeline configured for this venue' };
  }

  const { data: stageRows } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .select('id, name, kind, color, position')
    .eq('venue_id', venueId)
    .eq('pipeline_id', defaultPipelineId);
  const stages = (stageRows ?? []) as Array<{ id: string; name: string; kind: string; color: string | null; position: number }>;

  const qualifiedStage = stages.find((s) => s.name.toLowerCase().includes('qualified'));
  const conversationsStage = stages.find((s) => s.name.toLowerCase().includes('conversation'));
  if (!qualifiedStage || !conversationsStage) {
    return { ok: false, status: 500, error: 'Qualified/Conversations Started stage not found on the default pipeline' };
  }

  const stageById = new Map<string, LeadFunnelStageInfo>(
    stages.map((s) => [s.id, { name: s.name, kind: s.kind, position: s.position }]),
  );

  let currentStageInfo: LeadFunnelStageInfo | undefined = lead.stage_id ? stageById.get(lead.stage_id) : undefined;
  if (!currentStageInfo && lead.stage_id) {
    // Lead's stage lives on a different pipeline than the default one — still
    // resolve it so rank-based guarding stays correct (e.g. a custom pipeline
    // stage named "Tour Booked" should still block the toggle).
    const { data: otherStage } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('name, kind, position')
      .eq('id', lead.stage_id)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (otherStage) currentStageInfo = otherStage as LeadFunnelStageInfo;
  }

  const { rank } = leadRank(lead.status ?? 'new', currentStageInfo);
  if (rank >= 4) {
    return { ok: false, status: 422, error: 'Lead has already progressed past Qualified (Tour Booked, Proposal Sent, or Wedding Booked)' };
  }

  const currentlyQualified = lead.stage_id === qualifiedStage.id;
  const targetStage = currentlyQualified ? conversationsStage : qualifiedStage;

  const { error: updErr } = await supabaseAdmin
    .from('leads')
    .update({
      stage_id: targetStage.id,
      pipeline_id: defaultPipelineId,
      status: legacyStatusForStageName(targetStage.name),
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId)
    .eq('venue_id', venueId);
  if (updErr) return { ok: false, status: 500, error: updErr.message };

  return {
    ok: true,
    qualified: !currentlyQualified,
    previousStageId: lead.stage_id ?? null,
    stage: { id: targetStage.id, name: targetStage.name, color: targetStage.color, pipeline_id: defaultPipelineId },
    leadEmail: lead.email ?? null,
  };
}
