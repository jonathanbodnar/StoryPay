/**
 * AI Concierge — keep the lead's visible tag in sync with its `ai_state`.
 *
 * Migration 120 seeds five reserved system tags per venue:
 *   ai_active · ai_paused · ai_handoff · ai_opted_out · ai_exhausted
 *
 * `syncAiStateTag` is the single side-effect call that writes the
 * appropriate tag to `lead_tag_assignments` and removes any other AI
 * state tag the lead might still have. It is intentionally best-effort:
 * tag sync should never abort an AI run.
 *
 * The mapping is intentionally narrow — `dormant` removes all AI tags so
 * a lead that's been re-set to dormant looks "clean" again.
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { AiState } from './types';

// system_key seeded by migration 120
const STATE_TO_SYSTEM_KEY: Record<AiState, string | null> = {
  dormant:    null,
  ai_active:  'ai_active',
  paused:     'ai_paused',
  handoff:    'ai_handoff',
  opted_out:  'ai_opted_out',
  exhausted:  'ai_exhausted',
};

const ALL_AI_STATE_KEYS: readonly string[] = [
  'ai_active', 'ai_paused', 'ai_handoff', 'ai_opted_out', 'ai_exhausted',
];

/**
 * Apply the system tag matching `newState` to the lead, removing any other
 * AI state tag in the process. No-op for `dormant` aside from cleanup.
 */
export async function syncAiStateTag(
  leadId:  string,
  venueId: string,
  newState: AiState,
): Promise<void> {
  try {
    // Look up all AI state tags for this venue in one query
    const { data: tagRows, error: tagErr } = await supabaseAdmin
      .from('marketing_tags')
      .select('id, system_key')
      .eq('venue_id', venueId)
      .in('system_key', ALL_AI_STATE_KEYS as readonly string[]);

    if (tagErr) {
      // Migration 120 not yet applied or some other read error — silent skip
      if (tagErr.code !== '42P01' && tagErr.code !== '42703') {
        console.warn('[ai-tag-sync] failed to load AI state tags:', tagErr.message);
      }
      return;
    }

    const allTagIds: string[] = (tagRows ?? []).map((t: { id: string }) => t.id);
    if (allTagIds.length === 0) return; // No system tags seeded for this venue

    const wantedKey = STATE_TO_SYSTEM_KEY[newState];
    const wantedTag = wantedKey
      ? (tagRows ?? []).find((t: { id: string; system_key: string | null }) => t.system_key === wantedKey)
      : undefined;

    // 1. Remove any other AI state tags currently on the lead
    const idsToRemove = wantedTag
      ? allTagIds.filter((id) => id !== wantedTag.id)
      : allTagIds;
    if (idsToRemove.length > 0) {
      await supabaseAdmin
        .from('lead_tag_assignments')
        .delete()
        .eq('lead_id', leadId)
        .in('tag_id', idsToRemove);
    }

    // 2. Apply the wanted tag (idempotent upsert on (lead_id, tag_id) PK)
    if (wantedTag) {
      await supabaseAdmin
        .from('lead_tag_assignments')
        .upsert(
          { lead_id: leadId, tag_id: wantedTag.id, venue_id: venueId },
          { onConflict: 'lead_id,tag_id' },
        );
    }
  } catch (e) {
    console.warn('[ai-tag-sync] syncAiStateTag failed:', e instanceof Error ? e.message : e);
  }
}
