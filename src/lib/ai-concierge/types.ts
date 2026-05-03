/**
 * Shared types and constants for the AI Concierge feature.
 *
 * Everything else under `src/lib/ai-concierge/*` imports from here so the
 * canonical list of stages, tags, angles, and state values lives in one place.
 */

// ── State machine ──────────────────────────────────────────────────────────

export type AiState =
  | 'dormant'      // never activated, or returned to dormant via human re-enable
  | 'ai_active'    // AI is sending follow-ups
  | 'paused'       // bride replied; humans now own the conversation
  | 'exhausted'    // 60-day window elapsed; no more sends
  | 'opted_out'    // negative intent or TCPA hard opt-out
  | 'handoff';     // urgent escalation (lawyer/manager/refund/pricing/bot question)

export const AI_STATES: readonly AiState[] = [
  'dormant', 'ai_active', 'paused', 'exhausted', 'opted_out', 'handoff',
] as const;

// ── Pipeline stages ────────────────────────────────────────────────────────

export type AiStageKey = 'followup' | 'conversation_started' | 'not_interested';

export const AI_STAGE_KEYS: readonly AiStageKey[] = [
  'followup', 'conversation_started', 'not_interested',
] as const;

export interface AiStageDef {
  key:      AiStageKey;
  /** Display name we look up by (case + whitespace + plural-tolerant). */
  name:     string;
  color:    string;
  kind:     'open' | 'won' | 'lost';
}

export const AI_STAGE_DEFS: readonly AiStageDef[] = [
  { key: 'followup',             name: 'Followup',             color: '#ec4899', kind: 'open' },
  { key: 'conversation_started', name: 'Conversation Started', color: '#0ea5e9', kind: 'open' },
  { key: 'not_interested',       name: 'Not Interested',       color: '#9ca3af', kind: 'lost' },
] as const;

// ── Tags ───────────────────────────────────────────────────────────────────

export type AiTagKey =
  | 'ai_active'
  | 'ai_replied'
  | 'ai_not_interested'
  | 'ai_needs_human'
  | 'ai_exhausted';

export const AI_TAG_KEYS: readonly AiTagKey[] = [
  'ai_active', 'ai_replied', 'ai_not_interested', 'ai_needs_human', 'ai_exhausted',
] as const;

export interface AiTagDef {
  key:         AiTagKey;
  name:        string;
  category:    string;
  description: string;
  color:       string;
}

export const AI_TAG_DEFS: readonly AiTagDef[] = [
  { key: 'ai_active',         name: 'AI Active',             category: 'AI Concierge', description: 'AI is actively following up with this contact via SMS',                            color: '#8b5cf6' },
  { key: 'ai_replied',        name: 'Replied',               category: 'AI Concierge', description: 'Contact replied to an AI follow-up — humans should take over',                    color: '#3b82f6' },
  { key: 'ai_not_interested', name: 'Not Interested',        category: 'AI Concierge', description: 'Contact opted out, said no, or chose another venue',                              color: '#6b7280' },
  { key: 'ai_needs_human',    name: 'Needs Human Attention', category: 'AI Concierge', description: 'Urgent escalation — pricing, lawyer, manager, refund, or "are you a bot?" reply', color: '#dc2626' },
  { key: 'ai_exhausted',      name: 'AI Exhausted',          category: 'AI Concierge', description: 'Reached the 60-day max outreach window without a reply',                          color: '#9ca3af' },
] as const;

// ── Angles ─────────────────────────────────────────────────────────────────

export type AiAngleKey =
  | 'casual_check_in'
  | 'wedding_vision'
  | 'permission_to_ghost'
  | 'helpful_offer'
  | 'curiosity_process'
  | 'date_driven'
  | 'soft_reintroduction'
  | 'acknowledge_overwhelm'
  | 'open_ended';

export const AI_ANGLE_KEYS: readonly AiAngleKey[] = [
  'casual_check_in', 'wedding_vision', 'permission_to_ghost', 'helpful_offer',
  'curiosity_process', 'date_driven', 'soft_reintroduction', 'acknowledge_overwhelm',
  'open_ended',
] as const;

export function isAiAngleKey(s: string): s is AiAngleKey {
  return (AI_ANGLE_KEYS as readonly string[]).includes(s);
}

// ── Cached venue resources (the jsonb shape on venues.ai_concierge_resources)

export interface AiVenueResources {
  /** Pipeline whose stages we use. Always the venue's default pipeline. */
  pipeline_id?: string;
  /** Stage UUIDs keyed by AiStageKey. Resolved once when AI is toggled on. */
  stages?: Partial<Record<AiStageKey, string>>;
  /** Tag UUIDs keyed by AiTagKey. Resolved once when AI is toggled on. */
  tags?: Partial<Record<AiTagKey, string>>;
  /** ISO timestamp of last successful resolve — debugging aid. */
  resolved_at?: string;
}

// ── State transition reasons ───────────────────────────────────────────────

export type AiTransitionReason =
  | 'first_activation'
  | 'manually_re_enabled'
  | 'inbound_reply'
  | 'inbound_negative_intent'
  | 'inbound_handoff_keyword'
  | 'inbound_pricing_keyword'
  | 'inbound_tcpa_opt_out'
  | 'expired_60_days'
  | 'venue_disabled_ai'
  | 'admin_force_reset';

// ── Helpers for fuzzy name matching ────────────────────────────────────────

/**
 * Normalize a stage / tag name for fuzzy matching.
 *
 * Lowercase, strip every non-alphanumeric character, and strip a single
 * trailing 's' from each whitespace-separated word so:
 *
 *   "Follow Up"           → "followup"
 *   "Followup"            → "followup"
 *   "Follow-up"           → "followup"
 *   "Conversation Started"  → "conversationstarted"
 *   "Conversations Started" → "conversationstarted"
 *   "Not Interested"      → "notinterested"
 */
export function normalizeStageOrTagName(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/s$/, ''))      // strip trailing plural-s per word
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

/** True if two display names are fuzzy-equivalent under our matcher. */
export function fuzzyNamesMatch(a: string, b: string): boolean {
  return normalizeStageOrTagName(a) === normalizeStageOrTagName(b);
}
