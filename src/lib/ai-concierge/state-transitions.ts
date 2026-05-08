/**
 * Audit-log helper for AI Concierge state transitions.
 *
 * Every state change (cron-driven, webhook-driven, or human-driven) writes
 * one row here so the super-admin live runs monitor and any future debugging
 * has a clean trail. Best-effort: never throws — losing an audit row is
 * preferable to crashing the AI flow.
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { AiState, AiTransitionReason } from './types';
import { syncAiStateTag } from './state-tag-sync';

export interface RecordStateTransitionInput {
  leadId:       string;
  venueId:      string;
  fromState:    AiState | null;
  toState:      AiState;
  reason:       AiTransitionReason | string;
  /** Where the transition came from. Examples:
   *   'cron:ai-activate', 'cron:ai-send', 'webhook:ghl-inbound', 'user:<uuid>'
   */
  triggeredBy:  string;
  metadata?:    Record<string, unknown>;
}

export async function recordAiStateTransition(input: RecordStateTransitionInput): Promise<void> {
  try {
    await supabaseAdmin.from('ai_state_transitions').insert({
      lead_id:      input.leadId,
      venue_id:     input.venueId,
      from_state:   input.fromState,
      to_state:     input.toState,
      reason:       input.reason,
      triggered_by: input.triggeredBy,
      metadata:     input.metadata ?? null,
    });
  } catch (e) {
    console.error('[ai-concierge] recordAiStateTransition failed:', e);
  }

  // Side-effect: keep the lead's visible AI state tag in sync. Best-effort,
  // never throws (see state-tag-sync.ts).
  void syncAiStateTag(input.leadId, input.venueId, input.toState);
}
