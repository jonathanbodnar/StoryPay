import { supabaseAdmin } from '@/lib/supabase';

/**
 * Shared helpers for the Lead Pipeline feature.
 *
 * Two pieces the app relies on:
 *   1. A default template that every new venue starts with (customers get the
 *      pipeline the user described — Lead, Conversations Started, Lead
 *      Contacted, Tour Booked, Proposal Sent, Wedding Booked, Follow up, Not
 *      Interested).
 *   2. A "lazy provision" helper: when a venue hits the Leads page for the
 *      first time we make sure they have a default pipeline with the template
 *      stages so the Kanban has something to render.
 */

export type StageKind = 'open' | 'won' | 'lost';

export interface StageTemplate {
  name: string;
  color: string;
  kind: StageKind;
}

export const DEFAULT_PIPELINE_NAME = 'Sales Pipeline';

// Colors mirror the old STATUS pill palette where sensible so the switch from
// the legacy status field to stage_id doesn't change the color of existing
// cards. New stages ("Conversations Started", "Follow up") get their own
// colors.
export const DEFAULT_STAGE_TEMPLATE: StageTemplate[] = [
  { name: 'Lead',                 color: '#3b82f6', kind: 'open' },  // blue
  { name: 'Conversations Started',color: '#0ea5e9', kind: 'open' },  // sky
  { name: 'Lead Contacted',       color: '#f59e0b', kind: 'open' },  // amber
  { name: 'Tour Booked',          color: '#6366f1', kind: 'open' },  // indigo
  { name: 'Proposal Sent',        color: '#8b5cf6', kind: 'open' },  // violet
  { name: 'Wedding Booked',       color: '#10b981', kind: 'won'  },  // emerald
  { name: 'Follow up',            color: '#ec4899', kind: 'open' },  // pink
  { name: 'Not Interested',       color: '#9ca3af', kind: 'lost' },  // gray
];

// Map legacy `leads.status` values → default-template stage names. Used when
// we migrate a venue's existing leads onto the new pipeline for the first
// time so the cards land in the right Kanban column.
export const LEGACY_STATUS_TO_STAGE: Record<string, string> = {
  new:             'Lead',
  contacted:       'Lead Contacted',
  tour_booked:     'Tour Booked',
  proposal_sent:   'Proposal Sent',
  booked_wedding:  'Wedding Booked',
  not_interested:  'Not Interested',
};

export interface PipelineRow {
  id: string;
  venue_id: string;
  name: string;
  is_default: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface StageRow {
  id: string;
  pipeline_id: string;
  venue_id: string;
  name: string;
  color: string;
  kind: StageKind;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * Make sure a venue has at least one pipeline with the default stages. If
 * they already have pipelines, we leave everything alone. Returns the default
 * pipeline id so callers can point the UI at it.
 *
 * This is idempotent and cheap enough to call on every GET /api/pipelines.
 */
export async function ensureDefaultPipeline(venueId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from('lead_pipelines')
    .select('id, is_default')
    .eq('venue_id', venueId)
    .limit(1);

  if (existing && existing.length > 0) {
    // Already provisioned. Pick the default, or fall back to the first row.
    const def = existing.find((p) => p.is_default);
    return (def ?? existing[0]).id;
  }

  const { data: pipeline, error: pErr } = await supabaseAdmin
    .from('lead_pipelines')
    .insert({
      venue_id:   venueId,
      name:       DEFAULT_PIPELINE_NAME,
      is_default: true,
      position:   0,
    })
    .select('id')
    .single();

  if (pErr || !pipeline) {
    throw new Error(`Failed to create default pipeline: ${pErr?.message || 'unknown error'}`);
  }

  const stageRows = DEFAULT_STAGE_TEMPLATE.map((s, i) => ({
    pipeline_id: pipeline.id,
    venue_id:    venueId,
    name:        s.name,
    color:       s.color,
    kind:        s.kind,
    position:    i,
  }));

  const { data: stages, error: sErr } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .insert(stageRows)
    .select('id, name');

  if (sErr) {
    console.error('[ensureDefaultPipeline] stages insert failed:', sErr);
    throw new Error(`Failed to create default stages: ${sErr.message}`);
  }

  // Move any existing leads onto the new pipeline, mapping legacy status →
  // stage where we can.
  const stageIdByName = new Map<string, string>();
  for (const s of stages ?? []) stageIdByName.set(s.name, s.id);

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, status')
    .eq('venue_id', venueId)
    .is('pipeline_id', null);

  if (leads && leads.length > 0) {
    // Supabase doesn't let us do a CASE update in one call, so update each
    // legacy bucket in a small loop. Tiny venues only — this is one-shot.
    const updates: Array<{ id: string; stage_id: string }> = [];
    for (const l of leads) {
      const targetName = LEGACY_STATUS_TO_STAGE[l.status as string] ?? 'Lead';
      const stageId = stageIdByName.get(targetName) ?? stageIdByName.get('Lead');
      if (stageId) updates.push({ id: l.id, stage_id: stageId });
    }

    // Group by stage_id so we can batch.
    const byStage = new Map<string, string[]>();
    for (const u of updates) {
      const arr = byStage.get(u.stage_id) ?? [];
      arr.push(u.id);
      byStage.set(u.stage_id, arr);
    }

    for (const [stageId, ids] of byStage) {
      await supabaseAdmin
        .from('leads')
        .update({ pipeline_id: pipeline.id, stage_id: stageId })
        .in('id', ids);
    }
  }

  return pipeline.id;
}

/**
 * Build the "full shape" response a pipeline picker cares about: each
 * pipeline with its stages, already sorted by position.
 */
export async function loadPipelinesWithStages(venueId: string) {
  const [{ data: pipelines }, { data: stages }] = await Promise.all([
    supabaseAdmin
      .from('lead_pipelines')
      .select('*')
      .eq('venue_id', venueId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('lead_pipeline_stages')
      .select('*')
      .eq('venue_id', venueId)
      .order('position', { ascending: true }),
  ]);

  const byPipeline = new Map<string, StageRow[]>();
  for (const s of (stages ?? []) as StageRow[]) {
    const arr = byPipeline.get(s.pipeline_id) ?? [];
    arr.push(s);
    byPipeline.set(s.pipeline_id, arr);
  }

  return ((pipelines ?? []) as PipelineRow[]).map((p) => ({
    ...p,
    stages: byPipeline.get(p.id) ?? [],
  }));
}
