import { supabaseAdmin } from '@/lib/supabase';
import { ensureDefaultPipeline, legacyStatusForStageName, loadPipelinesWithStages } from '@/lib/pipelines';
import { onMarketingStageChanged } from '@/lib/marketing-email-worker';
import { slugifyStageLabel } from '@/lib/pipeline-stage-slug';

export { slugifyStageLabel } from '@/lib/pipeline-stage-slug';

export async function fetchStageRow(venueId: string, stageId: string) {
  const { data } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .select('id, name, pipeline_id')
    .eq('id', stageId)
    .eq('venue_id', venueId)
    .maybeSingle();
  return data as { id: string; name: string; pipeline_id: string } | null;
}

/** Mirror lead pipeline/stage onto venue_customer with the same email (case-insensitive). */
export async function syncVenueCustomerFromLeadRow(
  venueId: string,
  lead: { email: string | null; pipeline_id: string | null; stage_id: string | null },
) {
  const email = (lead.email || '').trim().toLowerCase();
  if (!email || !lead.pipeline_id || !lead.stage_id) return;

  const stage = await fetchStageRow(venueId, lead.stage_id);
  if (!stage || stage.pipeline_id !== lead.pipeline_id) return;

  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('id')
    .eq('venue_id', venueId)
    .ilike('customer_email', email)
    .maybeSingle();
  if (!vc) return;

  await supabaseAdmin
    .from('venue_customers')
    .update({
      pipeline_id: lead.pipeline_id,
      stage_id: lead.stage_id,
      pipeline_stage: slugifyStageLabel(stage.name),
      updated_at: new Date().toISOString(),
    })
    .eq('id', (vc as { id: string }).id)
    .eq('venue_id', venueId);
}

/** Mirror venue_customer pipeline onto matching lead (same email). Fires marketing hooks if stage changes. */
export async function syncLeadFromVenueCustomerRow(
  venueId: string,
  vc: { customer_email: string; pipeline_id: string | null; stage_id: string | null },
) {
  const email = (vc.customer_email || '').trim().toLowerCase();
  if (!email || !vc.pipeline_id || !vc.stage_id) return;

  const stage = await fetchStageRow(venueId, vc.stage_id);
  if (!stage || stage.pipeline_id !== vc.pipeline_id) return;

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, stage_id')
    .eq('venue_id', venueId)
    .ilike('email', email)
    .maybeSingle();
  if (!lead) return;

  const prevStageId = (lead as { stage_id: string | null }).stage_id ?? null;
  const leadId = (lead as { id: string }).id;

  await supabaseAdmin
    .from('leads')
    .update({
      pipeline_id: vc.pipeline_id,
      stage_id: vc.stage_id,
      status: legacyStatusForStageName(stage.name),
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId)
    .eq('venue_id', venueId);

  if (prevStageId && vc.stage_id && prevStageId !== vc.stage_id) {
    void onMarketingStageChanged(venueId, leadId, vc.stage_id);
  }
}

export type PipelineContext = {
  pipelineId: string;
  stageId: string;
  linkedLeadId: string | null;
  /** True when IDs came from the linked lead because venue_customer had none */
  resolvedFromLead: boolean;
};

export async function resolveVenueCustomerPipelineContext(
  venueId: string,
  vc: { customer_email: string; pipeline_id: string | null; stage_id: string | null },
): Promise<PipelineContext | null> {
  await ensureDefaultPipeline(venueId);

  const email = vc.customer_email.trim().toLowerCase();
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, pipeline_id, stage_id')
    .eq('venue_id', venueId)
    .ilike('email', email)
    .maybeSingle();

  let pipelineId = vc.pipeline_id;
  let stageId = vc.stage_id;
  let resolvedFromLead = false;

  if (pipelineId && stageId) {
    const st = await fetchStageRow(venueId, stageId);
    if (!st || st.pipeline_id !== pipelineId) {
      pipelineId = null;
      stageId = null;
    }
  }

  if (!pipelineId || !stageId) {
    const lr = lead as { pipeline_id: string | null; stage_id: string | null } | null;
    if (lr?.pipeline_id && lr?.stage_id) {
      const st = await fetchStageRow(venueId, lr.stage_id);
      if (st && st.pipeline_id === lr.pipeline_id) {
        pipelineId = lr.pipeline_id;
        stageId = lr.stage_id;
        resolvedFromLead = true;
      }
    }
  }

  if (!pipelineId || !stageId) {
    const pipes = await loadPipelinesWithStages(venueId);
    const def = pipes.find((p) => p.is_default) ?? pipes[0];
    const stg = def?.stages?.[0];
    if (def && stg) {
      pipelineId = def.id;
      stageId = stg.id;
    }
  }

  if (!pipelineId || !stageId) return null;

  return {
    pipelineId,
    stageId,
    linkedLeadId: lead ? String((lead as { id: string }).id) : null,
    resolvedFromLead,
  };
}
