/**
 * AI Concierge — Pipeline + Tag service.
 *
 * The single touch-point any AI code (cron jobs, inbound webhook hooks,
 * human re-enable button) uses to move a lead between AI pipeline stages
 * or apply/remove AI tags. The AI engine NEVER touches `lead_pipeline_stages`,
 * `lead_tag_assignments`, or `marketing_tags` directly — only this service.
 *
 * Internally:
 *   - Reads the cached UUIDs from `venues.ai_concierge_resources`. If the
 *     cache is stale or empty, runs the resolver to populate it.
 *   - Wraps the existing `pipelines` + `system-tags` + `marketing-email-worker`
 *     helpers so workflow triggers, integration events, and venue_customer
 *     mirroring all continue to fire the same way they do for manual edits.
 *   - Failures are logged but never thrown — the AI state machine should keep
 *     advancing even if a tag/stage write hits a transient error. AI safety
 *     trumps pipeline integrity.
 */

import { supabaseAdmin } from '@/lib/supabase';
import {
  syncVenueCustomerFromLeadRow,
  fetchStageRow,
} from '@/lib/venue-customer-pipeline-sync';
import {
  onMarketingStageChanged,
  onMarketingTagAdded,
} from '@/lib/marketing-email-worker';
import { dispatchIntegrationEvent } from '@/lib/integration-events';
import { legacyStatusForStageName } from '@/lib/pipelines';

import {
  ensureVenueAiResources,
  refreshVenueAiResources,
} from './venue-resources';
import type {
  AiStageKey,
  AiTagKey,
  AiVenueResources,
} from './types';

// ── Public API ─────────────────────────────────────────────────────────────

export interface MoveLeadToStageResult {
  ok:        boolean;
  pipelineId?: string;
  stageId?:   string;
  error?:    string;
}

/**
 * Move a lead to one of the AI pipeline stages (followup / conversation_started
 * / not_interested). Mirrors the change to `venue_customers` and fires the
 * standard `onMarketingStageChanged` workflow hook so any user-built
 * automations bound to that stage trigger as expected.
 *
 * Idempotent: if the lead is already on the target stage, this is a no-op.
 */
export async function moveLeadToAiStage(
  venueId: string,
  leadId: string,
  stageKey: AiStageKey,
): Promise<MoveLeadToStageResult> {
  try {
    const stageId = await resolveStageId(venueId, stageKey);
    if (!stageId) {
      return { ok: false, error: `AI stage "${stageKey}" could not be resolved for venue ${venueId}` };
    }

    // Read the current lead row + stage so we can fire workflow hooks correctly
    const { data: leadRow, error: leadErr } = await supabaseAdmin
      .from('leads')
      .select('id, venue_id, email, pipeline_id, stage_id')
      .eq('id', leadId)
      .eq('venue_id', venueId)
      .maybeSingle();

    if (leadErr || !leadRow) {
      return { ok: false, error: `Lead ${leadId} not found for venue ${venueId}` };
    }

    const lead = leadRow as { id: string; venue_id: string; email: string | null; pipeline_id: string | null; stage_id: string | null };

    // Already there — no-op
    if (lead.stage_id === stageId) {
      return { ok: true, pipelineId: lead.pipeline_id ?? undefined, stageId };
    }

    // Fetch the stage to get its pipeline + name (we trust the cached UUID
    // was resolved against the venue's default pipeline, but pipelines.ts
    // hands us the canonical row).
    const stage = await fetchStageRow(venueId, stageId);
    if (!stage) {
      // Cache is stale — force refresh and retry once
      await refreshVenueAiResources(venueId);
      const retryStageId = await resolveStageId(venueId, stageKey);
      if (!retryStageId) return { ok: false, error: 'AI stage cache refresh failed' };
      const retryStage = await fetchStageRow(venueId, retryStageId);
      if (!retryStage) return { ok: false, error: 'AI stage row no longer exists' };
      return moveLeadToAiStage(venueId, leadId, stageKey);
    }

    const newPipelineId = stage.pipeline_id;
    const status        = legacyStatusForStageName(stage.name);

    const prevStageId = lead.stage_id;

    const { error: updErr } = await supabaseAdmin
      .from('leads')
      .update({
        pipeline_id: newPipelineId,
        stage_id:    stageId,
        status,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', leadId)
      .eq('venue_id', venueId);

    if (updErr) {
      // Some installs don't have `excluded_from_pipeline` removed as part of a
      // stage move — this is the known retry path. Mirror what
      // syncLeadFromVenueCustomerRow does: log and return the error.
      console.error('[ai-concierge] moveLeadToAiStage update failed:', updErr.message);
      return { ok: false, error: updErr.message };
    }

    // Mirror to venue_customers (best-effort — never crashes the AI flow)
    void syncVenueCustomerFromLeadRow(venueId, {
      email:       lead.email,
      pipeline_id: newPipelineId,
      stage_id:    stageId,
    }).catch((e) => {
      console.error('[ai-concierge] syncVenueCustomerFromLeadRow failed:', e);
    });

    // Fire the workflow trigger for stage changes
    if (prevStageId !== stageId) {
      void onMarketingStageChanged(venueId, leadId, stageId).catch((e) => {
        console.error('[ai-concierge] onMarketingStageChanged failed:', e);
      });
    }

    return { ok: true, pipelineId: newPipelineId, stageId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.error('[ai-concierge] moveLeadToAiStage exception:', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Apply an AI Concierge tag to a lead.
 *
 * The cached UUID may point to:
 *   - an AI-specific system tag we created with `system_key='ai_*'`, OR
 *   - an existing venue tag whose name fuzzy-matched (e.g. the existing
 *     `replied` system tag, or a venue's own custom "Not Interested" tag).
 *
 * Either way we apply by UUID and fire the standard workflow hooks. Safe to
 * fire-and-forget — never throws.
 */
export async function applyAiTag(
  venueId: string,
  leadId: string,
  tagKey: AiTagKey,
): Promise<void> {
  try {
    const tagId = await resolveTagId(venueId, tagKey);
    if (!tagId) {
      console.warn(`[ai-concierge] applyAiTag: tag "${tagKey}" not in cache for venue ${venueId}`);
      return;
    }

    const { error } = await supabaseAdmin
      .from('lead_tag_assignments')
      .insert({ lead_id: leadId, tag_id: tagId, venue_id: venueId })
      .select('lead_id')
      .maybeSingle();

    if (error && error.code !== '23505') {
      // 23505 = duplicate (tag already on lead) — that's a no-op success
      console.error(`[ai-concierge] applyAiTag(${tagKey}) error:`, error.message);
      return;
    }

    // Fire workflow + integration hooks only when we actually inserted a row
    if (!error) {
      void onMarketingTagAdded(venueId, leadId, [tagId]).catch((e) => {
        console.error('[ai-concierge] onMarketingTagAdded failed:', e);
      });
      void dispatchIntegrationEvent(venueId, 'tag.added', {
        lead_id: leadId,
        tag: { id: tagId, system_key: tagKey },
      }).catch((e) => {
        console.error('[ai-concierge] dispatchIntegrationEvent failed:', e);
      });
    }
  } catch (e) {
    console.error(`[ai-concierge] applyAiTag(${tagKey}) exception:`, e);
  }
}

/**
 * Apply multiple AI tags in parallel.
 */
export async function applyAiTags(
  venueId: string,
  leadId: string,
  tagKeys: AiTagKey[],
): Promise<void> {
  await Promise.all(tagKeys.map((k) => applyAiTag(venueId, leadId, k)));
}

/**
 * Remove an AI Concierge tag from a lead. No-op if not present. Never throws.
 */
export async function removeAiTag(
  venueId: string,
  leadId: string,
  tagKey: AiTagKey,
): Promise<void> {
  try {
    const tagId = await resolveTagId(venueId, tagKey);
    if (!tagId) return;
    await supabaseAdmin
      .from('lead_tag_assignments')
      .delete()
      .eq('lead_id', leadId)
      .eq('tag_id',  tagId)
      .eq('venue_id', venueId);
  } catch (e) {
    console.error(`[ai-concierge] removeAiTag(${tagKey}) exception:`, e);
  }
}

/**
 * Remove multiple AI tags in parallel.
 */
export async function removeAiTags(
  venueId: string,
  leadId: string,
  tagKeys: AiTagKey[],
): Promise<void> {
  await Promise.all(tagKeys.map((k) => removeAiTag(venueId, leadId, k)));
}

// ── Private helpers ────────────────────────────────────────────────────────

/** Resolve a stage UUID from cache, refreshing once if missing. */
async function resolveStageId(venueId: string, stageKey: AiStageKey): Promise<string | null> {
  const cached = await ensureVenueAiResources(venueId);
  const id = cached.stages?.[stageKey];
  if (id) return id;
  const refreshed = await refreshVenueAiResources(venueId);
  return refreshed.stages?.[stageKey] ?? null;
}

/** Resolve a tag UUID from cache, refreshing once if missing. */
async function resolveTagId(venueId: string, tagKey: AiTagKey): Promise<string | null> {
  const cached = await ensureVenueAiResources(venueId);
  const id = cached.tags?.[tagKey];
  if (id) return id;
  const refreshed = await refreshVenueAiResources(venueId);
  return refreshed.tags?.[tagKey] ?? null;
}

// ── Re-exports so callers only import this one file ────────────────────────

export {
  ensureVenueAiResources,
  refreshVenueAiResources,
} from './venue-resources';

export type { AiVenueResources, AiStageKey, AiTagKey };
