/**
 * Regex / rule tester for the handoff-rules editor.
 *
 *   POST { body: string, ruleId?: string, triggerValue?: string }
 *
 * Two modes:
 *   - With { triggerValue }: test a candidate regex against the body before
 *     saving. Returns the match (or compile error) without touching the DB.
 *   - With { ruleId }: test against an existing rule's regex.
 *   - With neither: evaluate ALL active keyword rules in priority order,
 *     returning the first match (mirrors what the inbound webhook does).
 *
 * Always returns 200 — compile failures and "no match" are normal results
 * the UI needs to display, not error states.
 *
 * No DB writes, no LLM calls, no SMS sends. Pure read + regex compile.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { evaluateKeywordRules, loadActiveHandoffRules } from '@/lib/ai-concierge/handoff-rules';

export const dynamic = 'force-dynamic';

interface TestBody {
  body?:         string;
  triggerValue?: string;
  ruleId?:       string;
}

interface TestResponse {
  matched:       boolean;
  matchedText?:  string;
  matchIndex?:   number;
  ruleId?:       string;
  ruleType?:     'keyword' | 'intent';
  /** Compile error (regex syntax). Only set when triggerValue is invalid. */
  compileError?: string;
  /** Full evaluation log when running against all active rules. */
  evaluation?: Array<{
    ruleId:       string;
    description:  string | null;
    triggerValue: string;
    matched:      boolean;
    error?:       string;
  }>;
}

export async function POST(request: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: TestBody;
  try { body = await request.json() as TestBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const messageBody = (body.body ?? '').toString();
  if (!messageBody.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }

  // ── Mode 1: ad-hoc trigger value ────────────────────────────────────────
  if (typeof body.triggerValue === 'string' && body.triggerValue.trim()) {
    return NextResponse.json(testSingleRegex(body.triggerValue, messageBody));
  }

  // ── Mode 2: existing rule by ID ─────────────────────────────────────────
  if (typeof body.ruleId === 'string' && body.ruleId.trim()) {
    const { data, error } = await supabaseAdmin
      .from('handoff_rules')
      .select('id, rule_type, trigger_value')
      .eq('id', body.ruleId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)  return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    if (data.rule_type !== 'keyword') {
      return NextResponse.json({
        matched:  false,
        ruleId:   data.id,
        ruleType: data.rule_type,
        compileError: 'Intent rules cannot be regex-tested — they are matched by the LLM intent classifier, not regex.',
      } satisfies TestResponse);
    }
    const r = testSingleRegex(data.trigger_value, messageBody);
    return NextResponse.json({ ...r, ruleId: data.id, ruleType: 'keyword' as const } satisfies TestResponse);
  }

  // ── Mode 3: full evaluation against all active keyword rules ────────────
  const rules = await loadActiveHandoffRules(true);
  const evaluation: NonNullable<TestResponse['evaluation']> = [];

  for (const rule of rules) {
    if (rule.rule_type !== 'keyword') continue;
    try {
      const m = new RegExp(rule.trigger_value, 'i').exec(messageBody);
      evaluation.push({
        ruleId:       rule.id,
        description:  rule.description,
        triggerValue: rule.trigger_value,
        matched:      m !== null,
      });
    } catch (e) {
      evaluation.push({
        ruleId:       rule.id,
        description:  rule.description,
        triggerValue: rule.trigger_value,
        matched:      false,
        error:        e instanceof Error ? e.message : 'invalid regex',
      });
    }
  }

  // First match wins (mirrors evaluateKeywordRules)
  const firstMatch = evaluateKeywordRules(rules, messageBody);
  if (firstMatch) {
    return NextResponse.json({
      matched:      true,
      matchedText:  firstMatch.matchedText,
      ruleId:       firstMatch.rule.id,
      ruleType:     firstMatch.rule.rule_type,
      evaluation,
    } satisfies TestResponse);
  }

  return NextResponse.json({
    matched: false,
    evaluation,
  } satisfies TestResponse);
}

function testSingleRegex(triggerValue: string, messageBody: string): TestResponse {
  let re: RegExp;
  try {
    re = new RegExp(triggerValue, 'i');
  } catch (e) {
    return {
      matched: false,
      compileError: e instanceof Error ? e.message : 'invalid regex',
    };
  }
  const m = re.exec(messageBody);
  if (!m) return { matched: false };
  return {
    matched:     true,
    matchedText: m[0],
    matchIndex:  m.index,
  };
}
