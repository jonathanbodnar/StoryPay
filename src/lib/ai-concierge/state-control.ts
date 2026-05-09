/**
 * AI Concierge — programmatic state control.
 *
 * The single canonical place to *change* a lead's `ai_state`. Any code path
 * that wants to flip a lead between dormant / ai_active / paused / handoff
 * should funnel through `setLeadAiState`. It handles:
 *
 *   - The actual `leads` row update (with the right side-effect timestamps
 *     for each transition — e.g. activation stamps ai_expires_at)
 *   - The audit row in `ai_state_transitions`
 *   - The system-tag sync (ai_active / ai_paused / ai_handoff visible in
 *     the lead's tag list)
 *
 * `setLeadAiState` is reused by:
 *   - PATCH /api/admin/ai-concierge/leads/[leadId]/state    (manual override)
 *   - POST  /api/admin/ai-concierge/leads/[leadId]/tags     (tag-driven)
 *   - POST  /api/dashboard/leads/[leadId]/tags              (venue-side)
 *
 * Reading the current state stays a simple `select ai_state from leads`
 * because there's no derived logic.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { recordAiStateTransition } from './state-transitions';
import type { AiState } from './types';

export interface SetLeadAiStateInput {
  leadId:      string;
  venueId:     string;
  newState:    AiState;
  reason:      string;
  triggeredBy: string;
  /** Pass true if you already loaded `leads.ai_state` so we skip a round-trip. */
  knownFromState?: AiState | null;
}

export interface SetLeadAiStateResult {
  ok:        boolean;
  fromState: AiState | null;
  toState:   AiState;
  /** True when the row was unchanged (already at toState). */
  noop:      boolean;
  error?:    string;
}

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS   = 60 * 60 * 1000;

export async function setLeadAiState(
  input: SetLeadAiStateInput,
): Promise<SetLeadAiStateResult> {
  const { leadId, venueId, newState, reason, triggeredBy } = input;

  // 1. Read current state (unless caller already has it)
  let fromState: AiState | null = input.knownFromState ?? null;
  if (fromState === undefined || fromState === null) {
    const { data: lead, error: readErr } = await supabaseAdmin
      .from('leads')
      .select('ai_state')
      .eq('id', leadId)
      .single();
    if (readErr || !lead) {
      return { ok: false, fromState: null, toState: newState, noop: false, error: readErr?.message ?? 'lead not found' };
    }
    fromState = (lead.ai_state as AiState | null) ?? null;
  }

  // No-op if already at target state
  if (fromState === newState) {
    return { ok: true, fromState, toState: newState, noop: true };
  }

  // 2. Compute the side-effect columns for this transition
  const now = new Date();
  const update: Record<string, unknown> = {
    ai_state:   newState,
    updated_at: now.toISOString(),
  };

  if (newState === 'ai_active') {
    if (fromState === 'paused') {
      // Resume — start immediately so the next cron run picks it up
      update.ai_next_send_at = now.toISOString();
    } else if (fromState === null || fromState === 'dormant') {
      // First-time activation — start the 60-day clock and queue an immediate send
      update.ai_first_activated_at      = now.toISOString();
      update.ai_expires_at              = new Date(now.getTime() + SIXTY_DAYS_MS).toISOString();
      update.ai_next_send_at            = now.toISOString();
      update.ai_booking_system_activated = true;
    }
  } else if (newState === 'paused' || newState === 'handoff') {
    // Stop the next scheduled send
    update.ai_next_send_at = null;
  } else if (newState === 'dormant') {
    update.ai_next_send_at = null;
  }

  // 3. Apply
  const { error: updateErr } = await supabaseAdmin
    .from('leads')
    .update(update)
    .eq('id', leadId);

  if (updateErr) {
    return { ok: false, fromState, toState: newState, noop: false, error: updateErr.message };
  }

  // 4. Audit + tag sync (recordAiStateTransition fires syncAiStateTag as a side effect)
  await recordAiStateTransition({
    leadId,
    venueId,
    fromState,
    toState:     newState,
    reason,
    triggeredBy,
  }).catch((e) => console.warn('[ai-state] transition log failed:', e));

  return { ok: true, fromState, toState: newState, noop: false };
}

/**
 * Map a marketing_tags.system_key to the ai_state it should drive a lead to
 * when an admin / venue owner manually applies that tag.
 *
 * Only the controllable states are listed — `ai_opted_out` and `ai_exhausted`
 * are deliberately excluded because they're outcome states the system enters
 * from real events (TCPA stop / 60-day expiry); letting an operator force
 * them via tag would mask misconfiguration.
 */
const TAG_KEY_TO_AI_STATE: Record<string, AiState> = {
  ai_active:  'ai_active',
  ai_paused:  'paused',
  ai_handoff: 'handoff',
};

/**
 * Inspect a list of newly-applied marketing tag IDs. If any of them is one of
 * our reserved AI control tags (system_key in ai_active / ai_paused /
 * ai_handoff), drive the lead to the corresponding AI state via setLeadAiState.
 *
 * Multiple AI tags in a single batch take the LAST one (rare edge case but
 * deterministic). Tag rows without a recognized system_key are ignored.
 *
 * Best-effort: never throws; logs and swallows errors so a transient failure
 * here doesn't break the surrounding tag-update API.
 */
export async function applyAiStateFromTagAdds(
  leadId:    string,
  venueId:   string,
  tagIds:    readonly string[],
  triggeredBy = 'venue_dashboard:tag',
): Promise<void> {
  if (tagIds.length === 0) return;
  try {
    const { data: rows } = await supabaseAdmin
      .from('marketing_tags')
      .select('id, system_key')
      .in('id', tagIds);

    let driveTo: AiState | null = null;
    let driveKey: string | null = null;
    for (const r of (rows ?? []) as { id: string; system_key: string | null }[]) {
      const key = r.system_key;
      if (key && TAG_KEY_TO_AI_STATE[key]) {
        driveTo  = TAG_KEY_TO_AI_STATE[key];
        driveKey = key;
      }
    }

    if (!driveTo) return;

    await setLeadAiState({
      leadId,
      venueId,
      newState:    driveTo,
      reason:      `tag_added:${driveKey}`,
      triggeredBy,
    });
  } catch (e) {
    console.warn('[ai-state-control] applyAiStateFromTagAdds failed:', e instanceof Error ? e.message : e);
  }
}
