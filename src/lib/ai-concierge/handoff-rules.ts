/**
 * AI Concierge — handoff rules loader and evaluator.
 *
 * Reads `public.handoff_rules` (seeded by migration 098) and evaluates inbound
 * SMS bodies against them. Two rule types:
 *
 *   - `keyword` — `trigger_value` is a JS-compatible regex string. Matches
 *     case-insensitively against the message body. First match in
 *     `position ASC` order wins.
 *   - `intent`  — `trigger_value` is one of the intent enum keys (e.g.
 *     `booked_elsewhere`, `not_interested`). Matched by the intent classifier
 *     in `intent-classifier.ts`, NOT by this module — but `findIntentRule`
 *     here looks up the corresponding rule row once the classifier returns
 *     a label.
 *
 * The rule's `action` (opt_out / stop_and_handoff / mark_not_interested),
 * `tags_to_apply`, `pipeline_stage`, and `notify_roles` are returned verbatim
 * to the inbound handler, which performs the side effects.
 *
 * Rules are cached for 60 seconds to keep webhook latency tight; super-admin
 * edits propagate within a minute. Call `clearHandoffRulesCache()` after
 * saving rule edits.
 */

import { supabaseAdmin } from '@/lib/supabase';

// ── Public types ───────────────────────────────────────────────────────────

export type HandoffAction = 'opt_out' | 'stop_and_handoff' | 'mark_not_interested';
export type HandoffNotifyRole = 'venue_owner' | 'concierge';

export interface HandoffRuleRow {
  id:             string;
  rule_type:      'keyword' | 'intent';
  trigger_value:  string;
  action:         HandoffAction;
  notify_roles:   string[];
  tags_to_apply:  string[];
  pipeline_stage: string | null;
  is_active:      boolean;
  position:       number;
  description:    string | null;
}

export interface KeywordRuleMatch {
  rule:        HandoffRuleRow;
  matchedText: string;
}

// ── Cache ──────────────────────────────────────────────────────────────────

let _cache: { rows: HandoffRuleRow[]; loadedAt: number } | null = null;
const CACHE_MS = 60_000;

export function clearHandoffRulesCache(): void {
  _cache = null;
}

// ── Loader ─────────────────────────────────────────────────────────────────

export async function loadActiveHandoffRules(force = false): Promise<HandoffRuleRow[]> {
  if (!force && _cache && Date.now() - _cache.loadedAt < CACHE_MS) {
    return _cache.rows;
  }
  const { data, error } = await supabaseAdmin
    .from('handoff_rules')
    .select('id, rule_type, trigger_value, action, notify_roles, tags_to_apply, pipeline_stage, is_active, position, description')
    .eq('is_active', true)
    .order('position', { ascending: true });

  if (error || !data) {
    console.error('[ai-concierge] loadActiveHandoffRules failed:', error?.message ?? 'no data');
    return [];
  }
  const rows = data as HandoffRuleRow[];
  _cache = { rows, loadedAt: Date.now() };
  return rows;
}

// ── Keyword evaluation ─────────────────────────────────────────────────────

/**
 * Evaluate the keyword rules against the message body. Returns the first
 * rule whose regex matches, or `null` if none match.
 *
 * Each rule's regex is compiled fresh per call — handoff_rules are short and
 * the cache hit is from the rule list itself, not the compiled regexes.
 * Compilation errors on a single rule are logged and that rule is skipped
 * (so a malformed rule doesn't kill all inbound classification).
 */
export function evaluateKeywordRules(
  rules: HandoffRuleRow[],
  body: string,
): KeywordRuleMatch | null {
  if (!body?.trim()) return null;

  for (const rule of rules) {
    if (rule.rule_type !== 'keyword') continue;
    let re: RegExp;
    try {
      re = new RegExp(rule.trigger_value, 'i');
    } catch (e) {
      console.error('[ai-concierge] handoff_rules: bad regex for rule', rule.id, e);
      continue;
    }
    const m = re.exec(body);
    if (m) {
      return { rule, matchedText: m[0] };
    }
  }
  return null;
}

// ── Intent rule lookup ─────────────────────────────────────────────────────

/**
 * Given a classified intent label, return the rule row for it (if any).
 * Used by the inbound handler after the LLM classifier decides between
 * `booked_elsewhere`, `not_interested`, etc.
 */
export function findIntentRule(
  rules: HandoffRuleRow[],
  intent: string,
): HandoffRuleRow | null {
  const wanted = intent.trim().toLowerCase();
  if (!wanted) return null;
  for (const rule of rules) {
    if (rule.rule_type !== 'intent') continue;
    if (rule.trigger_value.toLowerCase() === wanted) return rule;
  }
  return null;
}

/** All distinct intent keys the classifier could be asked to choose from. */
export function listIntentKeys(rules: HandoffRuleRow[]): string[] {
  const set = new Set<string>();
  for (const rule of rules) {
    if (rule.rule_type === 'intent') {
      set.add(rule.trigger_value.toLowerCase());
    }
  }
  return [...set];
}
