/**
 * AI Concierge — inbound webhook handler.
 *
 * Called by `src/app/api/webhooks/ghl/route.ts` after `insertInboundGhlSms`
 * has persisted the bride's reply to `conversation_messages`. We:
 *
 *   1. Resolve the lead row from the `venue_customer` (email match, then
 *      phone fallback). If no AI-relevant lead is found, return early.
 *   2. Skip if the lead's `ai_state` is not in {ai_active, paused, handoff}
 *      — we only intervene for contacts the AI is currently following up
 *      with (or has handed off but might escalate again).
 *   3. Run keyword rules from `handoff_rules` against the body. First match
 *      (by position ASC) wins.
 *   4. If no keyword match, ask DeepSeek to classify the intent against
 *      the intent rules + `neutral_reply`.
 *   5. Apply the resulting state machine outcome:
 *        - opt_out             → opted_out (TCPA already applied sms_dnd by
 *                                the webhook before us; we just align state)
 *        - mark_not_interested → opted_out
 *        - stop_and_handoff    → handoff (urgent escalation)
 *        - neutral_reply       → paused (humans take over)
 *   6. Apply tags from `tags_to_apply`, remove `ai_active`, move pipeline
 *      stage if specified.
 *   7. Email the venue owner and/or concierge team per the rule's
 *      `notify_roles`.
 *   8. Log a row to `ai_state_transitions` and one to `ai_runs`.
 *
 * Best-effort: any sub-step failure is logged but does NOT throw — the GHL
 * webhook MUST always return 200 to avoid GHL re-delivering the same payload
 * (which causes duplicate handling).
 */

import { supabaseAdmin } from '@/lib/supabase';
import { normalizePhone } from '@/lib/ghl';
import { applySystemTags, ensureSystemTagsForVenue } from '@/lib/system-tags';

import {
  loadActiveHandoffRules,
  evaluateKeywordRules,
  findIntentRule,
  listIntentKeys,
  type HandoffRuleRow,
  type HandoffAction,
} from './handoff-rules';
import { classifyInboundIntent } from './intent-classifier';
import {
  ensureVenueAiResources,
  applyAiTags,
  removeAiTag,
  moveLeadToAiStage,
} from './pipeline-tag-service';
import { recordAiStateTransition } from './state-transitions';
import { fetchLeadConversationHistory } from './conversation-helpers';
import { notifyAiOwner, type AiOwnerScenario, type AiNotifyRole } from './notifications';
import {
  type AiState,
  type AiStageKey,
  type AiTagKey,
  type AiTransitionReason,
  AI_STAGE_KEYS,
  AI_TAG_KEYS,
} from './types';

// ── Public types ───────────────────────────────────────────────────────────

export interface HandleInboundAiMessageInput {
  venueId:          string;
  /** From `insertInboundGhlSms` — the venue_customer that received the message. */
  venueCustomerId:  string;
  /** Raw bride reply body. */
  messageBody:      string;
  /** Optional GHL message id for the audit trail. */
  ghlMessageId?:    string | null;
}

export interface HandleInboundAiMessageResult {
  ok:                true;
  /** True if this message triggered an AI state transition. */
  acted:             boolean;
  /** Reason we did NOT act (when acted=false). */
  skippedReason?:    string;
  leadId?:           string;
  fromState?:        AiState;
  toState?:          AiState;
  /** The handoff_rules row that fired (or `null` if neutral_reply default). */
  matchedRule?:      HandoffRuleRow | null;
  /** Whether we used the keyword pass or the LLM intent classifier. */
  matchedVia?:       'keyword' | 'intent_classifier' | 'default_neutral';
  /** Final scenario emailed to the owner (or null if no notify). */
  notifiedScenario?: AiOwnerScenario | null;
}

// ── Lead resolution ────────────────────────────────────────────────────────

interface LeadAiSnapshot {
  id:           string;
  venue_id:     string;
  email:        string | null;
  phone:        string | null;
  first_name:   string | null;
  last_name:    string | null;
  name:         string | null;
  ai_state:     AiState;
  ai_attempt_count: number;
}

/**
 * Find the lead behind this venue_customer that the AI is following up with.
 *
 * Match priority: email exact (case-insensitive) → normalized phone. We pick
 * the most recent lead matching either, that's also currently in an
 * AI-relevant state.
 */
async function resolveLeadForAi(
  venueId: string,
  venueCustomerId: string,
): Promise<LeadAiSnapshot | null> {
  // Pull the venue_customer's matching keys
  const { data: vcRow } = await supabaseAdmin
    .from('venue_customers')
    .select('customer_email, phone')
    .eq('id', venueCustomerId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!vcRow) return null;

  const vc = vcRow as { customer_email: string | null; phone: string | null };
  const email = (vc.customer_email || '').trim().toLowerCase();
  const phoneNorm = normalizePhone(vc.phone);

  const SELECT = 'id, venue_id, email, phone, first_name, last_name, name, ai_state, ai_attempt_count';

  // Relevant AI states: active states first (ai_active/paused/handoff), then
  // dormant (14-day sequence still running). We prefer an active state if there
  // are multiple leads for the same contact.
  const AI_RELEVANT_STATES = ['ai_active', 'paused', 'handoff', 'dormant'] as const;

  // Try email match first
  if (email && !email.endsWith('@ghl-sms.storypay.placeholder')) {
    const { data: byEmail } = await supabaseAdmin
      .from('leads')
      .select(SELECT)
      .eq('venue_id', venueId)
      .ilike('email', email)
      .in('ai_state', [...AI_RELEVANT_STATES])
      // Prefer active/paused/handoff over dormant; within same state prefer newest
      .order('ai_state', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(1);
    const row = (byEmail as LeadAiSnapshot[] | null)?.[0];
    if (row) return row;
  }

  // Fall back to phone match
  if (phoneNorm) {
    const { data: phoneCandidates } = await supabaseAdmin
      .from('leads')
      .select(SELECT)
      .eq('venue_id', venueId)
      .in('ai_state', [...AI_RELEVANT_STATES]);
    if (phoneCandidates) {
      // Prefer active states; within ties, pick the newest lead
      const sorted = (phoneCandidates as LeadAiSnapshot[])
        .filter((c) => normalizePhone(c.phone) === phoneNorm)
        .sort((a, b) => {
          const order = ['ai_active', 'paused', 'handoff', 'dormant'];
          return order.indexOf(a.ai_state) - order.indexOf(b.ai_state);
        });
      if (sorted[0]) return sorted[0];
    }
  }

  return null;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function handleInboundAiMessage(
  input: HandleInboundAiMessageInput,
): Promise<HandleInboundAiMessageResult> {
  try {
    const body = (input.messageBody || '').trim();
    if (!body) {
      return { ok: true, acted: false, skippedReason: 'empty_body' };
    }

    // 1-2. Resolve lead + check AI state
    const lead = await resolveLeadForAi(input.venueId, input.venueCustomerId);
    if (!lead) {
      return { ok: true, acted: false, skippedReason: 'no_ai_relevant_lead' };
    }

    // Dormant fast-path: AI hasn't activated yet (14-day sequence still running).
    // We don't run the full state machine — just apply the 'replied' system tag
    // so any venue workflow listening to that trigger fires, and notify the owner
    // + concierge team directly so they know to respond manually.
    if (lead.ai_state === 'dormant') {
      return handleDormantLeadReply({ lead, input });
    }

    // 3. Keyword pass
    const rules = await loadActiveHandoffRules();
    const kwHit = evaluateKeywordRules(rules, body);

    let matchedRule: HandoffRuleRow | null = null;
    let matchedVia: 'keyword' | 'intent_classifier' | 'default_neutral' = 'default_neutral';
    let triggerLabel = '';

    if (kwHit) {
      matchedRule = kwHit.rule;
      matchedVia  = 'keyword';
      triggerLabel = `keyword:${kwHit.matchedText}`;
    } else {
      // 4. Intent classifier
      const intentKeys = listIntentKeys(rules);
      const history = await fetchLeadConversationHistory(input.venueId, lead.id, 6);
      const snippet = history
        .map((m) => `${m.sender_kind === 'contact' ? 'Bride' : 'You'}: ${m.body}`)
        .join('\n')
        .slice(0, 1500);

      const cls = await classifyInboundIntent({
        messageBody: body,
        allowedIntents: intentKeys,
        conversationSnippet: snippet || undefined,
      });

      if (cls.intent !== 'neutral_reply') {
        const intentRule = findIntentRule(rules, cls.intent);
        if (intentRule) {
          matchedRule = intentRule;
          matchedVia  = 'intent_classifier';
          triggerLabel = `intent:${cls.intent} (${cls.confidence})`;
        } else {
          // Classifier returned an intent we don't have a rule for — treat as neutral
          triggerLabel = `intent:${cls.intent} (no rule, defaulting to neutral)`;
        }
      } else {
        triggerLabel = `intent:neutral_reply (${cls.confidence})`;
      }
    }

    // 5-7. Apply outcome
    const outcome = matchedRule ? deriveOutcomeFromRule(matchedRule) : NEUTRAL_REPLY_OUTCOME;
    await ensureVenueAiResources(input.venueId);

    const fromState = lead.ai_state;
    await applyOutcome({ lead, outcome });

    await recordAiStateTransition({
      leadId:      lead.id,
      venueId:     input.venueId,
      fromState,
      toState:     outcome.toState,
      reason:      outcome.transitionReason,
      triggeredBy: 'webhook:ghl-inbound',
      metadata: {
        matchedVia,
        rule_id:        matchedRule?.id ?? null,
        rule_action:    matchedRule?.action ?? null,
        trigger_label:  triggerLabel,
        message_excerpt: body.slice(0, 300),
        ghl_message_id:  input.ghlMessageId ?? null,
      },
    });

    // 8. Notify
    const brideName = firstNameOf(lead);
    let notifiedScenario: AiOwnerScenario | null = null;
    if (outcome.scenario && outcome.notifyRoles.length > 0) {
      notifiedScenario = outcome.scenario;
      void notifyAiOwner({
        venueId:       input.venueId,
        leadId:        lead.id,
        scenario:      outcome.scenario,
        notifyRoles:   outcome.notifyRoles,
        brideName,
        brideFullName: fullNameOf(lead),
        brideReply:    body,
        matchedTrigger: triggerLabel,
      }).catch((e) => {
        console.error('[ai-concierge] notifyAiOwner failed:', e);
      });
    }

    // Audit row in ai_runs (kind=inbound). Reuses the same table the send
    // cron writes to so super-admin can scroll a single timeline.
    void supabaseAdmin.from('ai_runs').insert({
      lead_id:         lead.id,
      venue_id:        input.venueId,
      attempt_number:  lead.ai_attempt_count,
      input_context:   {
        kind:           'inbound',
        body:           body.slice(0, 800),
        matched_via:    matchedVia,
        rule_id:        matchedRule?.id ?? null,
        rule_action:    matchedRule?.action ?? null,
        trigger_label:  triggerLabel,
        from_state:     fromState,
        to_state:       outcome.toState,
        notify_roles:   outcome.notifyRoles,
      },
      outcome:         `inbound_${outcome.toState}`,
      sms_provider:    'ghl',
      provider_message_id: input.ghlMessageId ?? null,
    }).then(() => {}).then(undefined, (e) => {
      console.error('[ai-concierge] inbound ai_runs insert failed:', e);
    });

    return {
      ok:               true,
      acted:            true,
      leadId:           lead.id,
      fromState,
      toState:          outcome.toState,
      matchedRule,
      matchedVia,
      notifiedScenario,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('[ai-concierge] handleInboundAiMessage failed:', msg);
    return { ok: true, acted: false, skippedReason: `error:${msg}` };
  }
}

// ── Dormant-lead reply handler ─────────────────────────────────────────────

/**
 * A lead in `dormant` state replied during the 14-day follow-up sequence —
 * before the AI Concierge has activated. We don't run the full state machine
 * here. Instead we:
 *
 *   1. Apply the `replied` system tag so any workflow the venue built on that
 *      trigger fires automatically (e.g. a `notify_owner` workflow step).
 *   2. Send a direct notification to the venue owner + concierge team via the
 *      existing AI notification system so they know to respond manually right
 *      now — the AI is NOT taking over yet.
 *   3. Log to `ai_runs` for audit visibility.
 *
 * The lead's `ai_state` stays `dormant`. If the bride keeps the conversation
 * going with a human, the AI activation cron will never activate (because
 * `last_inbound_at` is now set, which the cron filters out). If the
 * conversation goes cold again after a human reply, the 14-day timer resets
 * from that new `last_outbound_at`.
 */
async function handleDormantLeadReply(opts: {
  lead:  LeadAiSnapshot;
  input: HandleInboundAiMessageInput;
}): Promise<HandleInboundAiMessageResult> {
  const { lead, input } = opts;
  const body = (input.messageBody || '').trim();

  // Step 1: apply 'replied' system tag — triggers any workflow configured on it
  try {
    await ensureSystemTagsForVenue(lead.venue_id);
    await applySystemTags(lead.venue_id, lead.id, ['replied']);
  } catch (e) {
    console.error('[ai-concierge] handleDormantLeadReply: applySystemTags failed:', e);
  }

  // Step 2: notify venue owner + concierge directly
  const brideName     = firstNameOf(lead);
  const brideFullName = fullNameOf(lead);
  void notifyAiOwner({
    venueId:       lead.venue_id,
    leadId:        lead.id,
    scenario:      'sequence_reply_received',
    notifyRoles:   ['venue_owner', 'concierge'],
    brideName,
    brideFullName,
    brideReply:    body,
    matchedTrigger: 'replied during 14-day sequence (AI not yet active)',
  }).catch((e) => {
    console.error('[ai-concierge] handleDormantLeadReply: notifyAiOwner failed:', e);
  });

  // Step 3: audit log (same table the send cron uses, kind='dormant_reply')
  void supabaseAdmin.from('ai_runs').insert({
    lead_id:             lead.id,
    venue_id:            input.venueId,
    attempt_number:      0,
    input_context:       {
      kind:        'dormant_reply',
      body:        body.slice(0, 800),
      ai_state:    'dormant',
    },
    outcome:             'dormant_reply_received',
    sms_provider:        'ghl',
    provider_message_id: input.ghlMessageId ?? null,
  }).then(() => {}).then(undefined, (e) => {
    console.error('[ai-concierge] handleDormantLeadReply: ai_runs insert failed:', e);
  });

  return {
    ok:               true,
    acted:            true,
    leadId:           lead.id,
    fromState:        'dormant',
    toState:          'dormant',   // state unchanged — sequence keeps running
    matchedRule:      null,
    matchedVia:       'default_neutral',
    notifiedScenario: 'sequence_reply_received',
  };
}

// ── Outcome derivation ─────────────────────────────────────────────────────

interface Outcome {
  toState:          AiState;
  /** Tags to apply (in addition to removing `ai_active`). */
  tags:             AiTagKey[];
  /** Pipeline stage to move the lead to (null = leave alone). */
  stage:            AiStageKey | null;
  /** Email scenario sent to owner / concierge, or null for no notification. */
  scenario:         AiOwnerScenario | null;
  /** Roles that receive the notification (subset of {venue_owner, concierge}). */
  notifyRoles:      AiNotifyRole[];
  /** Reason logged to ai_state_transitions. */
  transitionReason: AiTransitionReason;
  /** When true, this was a TCPA hard opt-out (sms_dnd already set by webhook). */
  isTcpa:           boolean;
}

const NEUTRAL_REPLY_OUTCOME: Outcome = {
  toState:          'paused',
  tags:             ['ai_replied'],
  stage:            'conversation_started',
  scenario:         'ai_reply_received',
  notifyRoles:      ['venue_owner'],
  transitionReason: 'inbound_reply',
  isTcpa:           false,
};

function deriveOutcomeFromRule(rule: HandoffRuleRow): Outcome {
  const action: HandoffAction = rule.action;
  const stage = sanitizeStageKey(rule.pipeline_stage);
  const tags  = sanitizeTagKeys(rule.tags_to_apply);
  const roles = sanitizeNotifyRoles(rule.notify_roles);

  switch (action) {
    case 'opt_out': {
      // TCPA hard opt-out — webhook already applied sms_dnd. Align state.
      return {
        toState:          'opted_out',
        tags:             tags.length ? tags : ['ai_not_interested'],
        stage:            stage ?? 'not_interested',
        scenario:         'ai_tcpa_opt_out',
        notifyRoles:      roles.length ? roles : ['venue_owner'],
        transitionReason: 'inbound_tcpa_opt_out',
        isTcpa:           true,
      };
    }
    case 'mark_not_interested': {
      return {
        toState:          'opted_out',
        tags:             tags.length ? tags : ['ai_not_interested'],
        stage:            stage ?? 'not_interested',
        scenario:         'ai_not_interested',
        notifyRoles:      roles.length ? roles : ['venue_owner'],
        transitionReason: 'inbound_negative_intent',
        isTcpa:           false,
      };
    }
    case 'stop_and_handoff':
    default: {
      // Pricing rule: notify_roles is concierge only → ai_handoff_pricing
      // Lawyer/manager/refund/bot rule: notify_roles includes venue_owner → ai_handoff_urgent
      const onlyConcierge =
        roles.length === 1 && roles[0] === 'concierge';
      return {
        toState:          'handoff',
        tags:             tags.length ? tags : ['ai_replied', 'ai_needs_human'],
        stage:            stage ?? 'conversation_started',
        scenario:         onlyConcierge ? 'ai_handoff_pricing' : 'ai_handoff_urgent',
        notifyRoles:      roles.length ? roles : ['venue_owner', 'concierge'],
        transitionReason: onlyConcierge ? 'inbound_pricing_keyword' : 'inbound_handoff_keyword',
        isTcpa:           false,
      };
    }
  }
}

function sanitizeStageKey(s: string | null | undefined): AiStageKey | null {
  if (!s) return null;
  const k = s.trim().toLowerCase();
  return (AI_STAGE_KEYS as readonly string[]).includes(k) ? (k as AiStageKey) : null;
}

function sanitizeTagKeys(arr: string[] | null | undefined): AiTagKey[] {
  if (!arr) return [];
  const set = AI_TAG_KEYS as readonly string[];
  return arr
    .map((v) => v.trim().toLowerCase())
    .filter((v): v is AiTagKey => set.includes(v as AiTagKey));
}

function sanitizeNotifyRoles(arr: string[] | null | undefined): AiNotifyRole[] {
  if (!arr) return [];
  return arr
    .map((v) => v.trim().toLowerCase())
    .filter((v): v is AiNotifyRole => v === 'venue_owner' || v === 'concierge');
}

// ── Outcome application ────────────────────────────────────────────────────

async function applyOutcome(opts: {
  lead:    LeadAiSnapshot;
  outcome: Outcome;
}): Promise<void> {
  const { lead, outcome } = opts;

  // Update lead AI state. Keep ai_first_activated_at + ai_expires_at as-is (60d
  // cap is global and shouldn't reset on a reply).
  const updatePatch: Record<string, unknown> = {
    ai_state:        outcome.toState,
    ai_next_send_at: null,
    updated_at:      new Date().toISOString(),
  };
  // For TCPA, the webhook already set sms_dnd. We don't touch it here so that
  // sms_dnd_source preserves whatever the webhook already wrote
  // ('inbound_stop_keyword' or 'ghl_webhook').

  try {
    await supabaseAdmin
      .from('leads')
      .update(updatePatch)
      .eq('id', lead.id)
      .eq('venue_id', lead.venue_id);
  } catch (e) {
    console.error('[ai-concierge] applyOutcome lead update failed:', e);
  }

  // Tags: apply new ones, then remove ai_active (since we're no longer actively
  // sending). Keep ai_replied across handoff → paused if both flows assign it.
  await applyAiTags(lead.venue_id, lead.id, outcome.tags);
  await removeAiTag(lead.venue_id, lead.id, 'ai_active');

  // Stage move
  if (outcome.stage) {
    await moveLeadToAiStage(lead.venue_id, lead.id, outcome.stage);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function firstNameOf(lead: LeadAiSnapshot): string {
  const fn = (lead.first_name || '').trim();
  if (fn) return fn;
  const split = (lead.name || '').trim().split(/\s+/);
  return split[0] || 'there';
}

function fullNameOf(lead: LeadAiSnapshot): string {
  const composed = [lead.first_name, lead.last_name]
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(' ');
  return composed || (lead.name || '').trim() || 'unknown';
}
