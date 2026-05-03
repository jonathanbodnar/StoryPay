/**
 * Venue resource resolver — runs once when a venue's AI Concierge toggle
 * flips on, and idempotently again on every state-changing AI op.
 *
 * Responsibilities:
 *   1. Make sure the venue has a default pipeline (delegates to the existing
 *      `ensureDefaultPipeline` helper).
 *   2. For each required AI pipeline stage ("Followup", "Conversation Started",
 *      "Not Interested"): fuzzy-match against the venue's existing stages on
 *      that pipeline. Use the existing one if it matches; otherwise create.
 *   3. For each required AI tag ("AI Active", "Replied", "Not Interested",
 *      "Needs Human Attention", "AI Exhausted"): fuzzy-match against the
 *      venue's existing `marketing_tags`. Use the existing one if it matches;
 *      otherwise create with `is_system=true` and our `system_key`.
 *   4. Cache all resolved IDs into `venues.ai_concierge_resources` jsonb so
 *      every later read is a single `venues` row fetch.
 *
 * Failures are logged but never throw — AI safety always trumps pipeline
 * integrity. If the resolver can't create a stage/tag, callers get a partial
 * resources object back and they decide whether to proceed.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { ensureDefaultPipeline } from '@/lib/pipelines';
import {
  AI_STAGE_DEFS,
  AI_TAG_DEFS,
  fuzzyNamesMatch,
  type AiStageDef,
  type AiStageKey,
  type AiTagDef,
  type AiTagKey,
  type AiVenueResources,
} from './types';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Idempotently ensure all AI Concierge resources exist for the given venue
 * and return the resolved IDs.
 *
 * Use the cached value when present (validated). Falls through to a full
 * resolve+cache when the cache is empty, stale, or references a deleted row.
 */
export async function ensureVenueAiResources(venueId: string): Promise<AiVenueResources> {
  if (!venueId) throw new Error('ensureVenueAiResources: venueId required');

  // 1. Read the cached resources (if any) along with the venue row
  const { data: venueRow, error: vErr } = await supabaseAdmin
    .from('venues')
    .select('id, ai_concierge_resources')
    .eq('id', venueId)
    .maybeSingle();

  if (vErr || !venueRow) {
    throw new Error(`ensureVenueAiResources: venue not found (${vErr?.message ?? 'unknown'})`);
  }

  const cached = ((venueRow as { ai_concierge_resources?: AiVenueResources }).ai_concierge_resources) ?? {};

  // 2. Quick path — verify the cache still references real rows
  if (await cacheIsValid(venueId, cached)) return cached;

  // 3. Full resolve
  return resolveAndCache(venueId);
}

/**
 * Force a full re-resolve and cache update. Use when stages or tags are
 * known to have been mutated outside the AI service (e.g. after an admin
 * deletes a tag and the cached UUID no longer exists).
 */
export async function refreshVenueAiResources(venueId: string): Promise<AiVenueResources> {
  return resolveAndCache(venueId);
}

// ── Internals ──────────────────────────────────────────────────────────────

/** Cheap validity check — every cached UUID must still exist. */
async function cacheIsValid(venueId: string, cached: AiVenueResources): Promise<boolean> {
  const stageIds = Object.values(cached.stages ?? {}).filter(Boolean) as string[];
  const tagIds   = Object.values(cached.tags   ?? {}).filter(Boolean) as string[];

  // Need every stage and every tag — if any are missing, re-resolve.
  if (stageIds.length !== AI_STAGE_DEFS.length) return false;
  if (tagIds.length   !== AI_TAG_DEFS.length)   return false;
  if (!cached.pipeline_id) return false;

  const [{ count: stageCount }, { count: tagCount }, { count: pipeCount }] = await Promise.all([
    supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .in('id', stageIds),
    supabaseAdmin
      .from('marketing_tags')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .in('id', tagIds),
    supabaseAdmin
      .from('lead_pipelines')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('id', cached.pipeline_id),
  ]);

  return (stageCount ?? 0) === stageIds.length
      && (tagCount   ?? 0) === tagIds.length
      && (pipeCount  ?? 0) === 1;
}

async function resolveAndCache(venueId: string): Promise<AiVenueResources> {
  // 1. Make sure the venue has a default pipeline + stages
  const pipelineId = await ensureDefaultPipeline(venueId);

  // 2. Resolve all stages on the default pipeline
  const stages = await resolveStages(venueId, pipelineId);

  // 3. Resolve all tags
  const tags = await resolveTags(venueId);

  const resources: AiVenueResources = {
    pipeline_id: pipelineId,
    stages,
    tags,
    resolved_at: new Date().toISOString(),
  };

  // 4. Cache onto the venue row
  await supabaseAdmin
    .from('venues')
    .update({ ai_concierge_resources: resources })
    .eq('id', venueId);

  return resources;
}

// ── Stage resolution ───────────────────────────────────────────────────────

async function resolveStages(
  venueId: string,
  pipelineId: string,
): Promise<Partial<Record<AiStageKey, string>>> {
  const { data: existing } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .select('id, name, position')
    .eq('venue_id', venueId)
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: true });

  const existingRows = (existing ?? []) as Array<{ id: string; name: string; position: number }>;
  const maxPos       = existingRows.reduce((m, r) => Math.max(m, r.position), -1);

  const result: Partial<Record<AiStageKey, string>> = {};

  let nextPosition = maxPos + 10;

  for (const def of AI_STAGE_DEFS) {
    const match = existingRows.find((r) => fuzzyNamesMatch(r.name, def.name));
    if (match) {
      result[def.key] = match.id;
      continue;
    }
    // Create
    const created = await createStage(venueId, pipelineId, def, nextPosition);
    if (created) {
      result[def.key] = created.id;
      // Append the freshly-created row so subsequent fuzzy matches in the
      // same loop see it (defensive — none of our 3 names overlap, but cheap).
      existingRows.push({ id: created.id, name: def.name, position: nextPosition });
      nextPosition += 10;
    }
  }

  return result;
}

async function createStage(
  venueId: string,
  pipelineId: string,
  def: AiStageDef,
  position: number,
): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .insert({
      venue_id:    venueId,
      pipeline_id: pipelineId,
      name:        def.name,
      color:       def.color,
      kind:        def.kind,
      position,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error(`[ai-concierge] failed to create stage "${def.name}":`, error?.message);
    return null;
  }
  return data as { id: string };
}

// ── Tag resolution ─────────────────────────────────────────────────────────

async function resolveTags(venueId: string): Promise<Partial<Record<AiTagKey, string>>> {
  const { data: existing } = await supabaseAdmin
    .from('marketing_tags')
    .select('id, name, system_key, is_system')
    .eq('venue_id', venueId);

  const existingRows = (existing ?? []) as Array<{
    id: string;
    name: string;
    system_key: string | null;
    is_system: boolean;
  }>;

  const result: Partial<Record<AiTagKey, string>> = {};

  for (const def of AI_TAG_DEFS) {
    // First preference: existing tag with our exact system_key
    const byKey = existingRows.find((r) => r.system_key === def.key);
    if (byKey) {
      result[def.key] = byKey.id;
      continue;
    }
    // Second preference: fuzzy name match (any tag — system or custom)
    const byName = existingRows.find((r) => fuzzyNamesMatch(r.name, def.name));
    if (byName) {
      result[def.key] = byName.id;
      continue;
    }
    // Otherwise create
    const created = await createTag(venueId, def);
    if (created) {
      result[def.key] = created.id;
      existingRows.push({
        id: created.id,
        name: def.name,
        system_key: def.key,
        is_system: true,
      });
    }
  }

  return result;
}

async function createTag(
  venueId: string,
  def: AiTagDef,
): Promise<{ id: string } | null> {
  // Push AI tags to the bottom of the tag list (high `position`).
  const { data: maxPosRow } = await supabaseAdmin
    .from('marketing_tags')
    .select('position')
    .eq('venue_id', venueId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPos = ((maxPosRow as { position?: number } | null)?.position ?? 0) + 10;

  const { data, error } = await supabaseAdmin
    .from('marketing_tags')
    .insert({
      venue_id:           venueId,
      name:               def.name,
      icon:               '',
      color:              def.color,
      position:           nextPos,
      is_system:          true,
      system_key:         def.key,
      category:           def.category,
      description:        def.description,
      auto_apply_events:  [],
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error(`[ai-concierge] failed to create tag "${def.name}":`, error?.message);
    return null;
  }
  return data as { id: string };
}
