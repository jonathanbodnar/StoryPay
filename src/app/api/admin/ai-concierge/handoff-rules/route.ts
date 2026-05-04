/**
 * Super-admin handoff-rules CRUD (list + create).
 *
 *   GET  → all rules (active + inactive), ordered by position
 *   POST → create a new rule, auto-assigning position to (max + 10)
 *
 * Validation:
 *   - rule_type: 'keyword' | 'intent'
 *   - action:    'opt_out' | 'stop_and_handoff' | 'mark_not_interested'
 *   - For rule_type='keyword' we attempt to compile the regex up-front and
 *     reject 422 with the JS error message if it doesn't compile (so the
 *     admin gets feedback BEFORE the rule ships to the cron).
 *   - tags_to_apply / notify_roles whitelisted server-side against the AI
 *     tag system + the two known notify roles. Anything else is rejected.
 *
 * Cache: clears the in-process handoff-rules cache after a write so the
 * operator sees their change immediately on the next inbound. Other Node
 * instances pick it up within the 60-second TTL.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { clearHandoffRulesCache } from '@/lib/ai-concierge/handoff-rules';

export const dynamic = 'force-dynamic';

// ── Whitelists ─────────────────────────────────────────────────────────────

const ALLOWED_RULE_TYPES   = ['keyword', 'intent'] as const;
const ALLOWED_ACTIONS      = ['opt_out', 'stop_and_handoff', 'mark_not_interested'] as const;
const ALLOWED_NOTIFY_ROLES = ['venue_owner', 'concierge'] as const;
const ALLOWED_TAGS         = ['ai_active', 'ai_replied', 'ai_not_interested', 'ai_needs_human', 'ai_exhausted'] as const;
const ALLOWED_STAGES       = ['followup', 'conversation_started', 'not_interested', null] as const;

type RuleType   = typeof ALLOWED_RULE_TYPES[number];
type Action     = typeof ALLOWED_ACTIONS[number];

// ── Row shape ──────────────────────────────────────────────────────────────

interface HandoffRuleRow {
  id:             string;
  rule_type:      RuleType;
  trigger_value:  string;
  action:         Action;
  notify_roles:   string[];
  tags_to_apply:  string[];
  pipeline_stage: string | null;
  is_active:      boolean;
  position:       number;
  description:    string | null;
  created_at:     string;
  updated_at:     string;
}

interface CreateBody {
  rule_type:      RuleType;
  trigger_value:  string;
  action:         Action;
  notify_roles?:  string[];
  tags_to_apply?: string[];
  pipeline_stage?: string | null;
  is_active?:     boolean;
  description?:   string;
  position?:      number;
}

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('handoff_rules')
    .select('id, rule_type, trigger_value, action, notify_roles, tags_to_apply, pipeline_stage, is_active, position, description, created_at, updated_at')
    .order('position', { ascending: true });

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ error: 'handoff_rules table missing — run migration 098', schemaMissing: true }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rules: (data ?? []) as HandoffRuleRow[],
    /** Returned for UI convenience (form selects / chip pickers). */
    enums: {
      rule_types:   ALLOWED_RULE_TYPES,
      actions:      ALLOWED_ACTIONS,
      notify_roles: ALLOWED_NOTIFY_ROLES,
      tags:         ALLOWED_TAGS,
      stages:       ALLOWED_STAGES.filter((s): s is NonNullable<typeof s> => s !== null),
    },
  });
}

// ── POST ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: CreateBody;
  try { body = await request.json() as CreateBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const v = validateRuleBody(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 422 });

  // Auto-assign a position if not supplied (max + 10, in increments of 10
  // so reorder leaves comfortable gaps).
  let nextPosition = body.position;
  if (typeof nextPosition !== 'number') {
    const { data: maxRow } = await supabaseAdmin
      .from('handoff_rules')
      .select('position')
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    nextPosition = (maxRow?.position ?? 0) + 10;
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('handoff_rules')
    .insert({
      rule_type:      body.rule_type,
      trigger_value:  body.trigger_value.trim(),
      action:         body.action,
      notify_roles:   body.notify_roles  ?? [],
      tags_to_apply:  body.tags_to_apply ?? [],
      pipeline_stage: body.pipeline_stage ?? null,
      is_active:      body.is_active ?? true,
      position:       nextPosition,
      description:    body.description ?? null,
    })
    .select('id, rule_type, trigger_value, action, notify_roles, tags_to_apply, pipeline_stage, is_active, position, description, created_at, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  clearHandoffRulesCache();
  return NextResponse.json({ rule: inserted as HandoffRuleRow }, { status: 201 });
}

// ── Validation ─────────────────────────────────────────────────────────────

interface ValidationOk    { ok: true }
interface ValidationFail  { ok: false; error: string }
type ValidationResult = ValidationOk | ValidationFail;

export function validateRuleBody(body: Partial<CreateBody>): ValidationResult {
  if (!body.rule_type || !ALLOWED_RULE_TYPES.includes(body.rule_type)) {
    return { ok: false, error: `rule_type must be one of: ${ALLOWED_RULE_TYPES.join(', ')}` };
  }
  if (!body.action || !ALLOWED_ACTIONS.includes(body.action)) {
    return { ok: false, error: `action must be one of: ${ALLOWED_ACTIONS.join(', ')}` };
  }
  if (typeof body.trigger_value !== 'string' || !body.trigger_value.trim()) {
    return { ok: false, error: 'trigger_value is required' };
  }

  // Compile-test keyword regex up front. Intent triggers are free-form keys.
  if (body.rule_type === 'keyword') {
    try { new RegExp(body.trigger_value, 'i'); }
    catch (e) {
      const msg = e instanceof Error ? e.message : 'invalid regex';
      return { ok: false, error: `trigger_value is not a valid regex: ${msg}` };
    }
  }

  if (body.notify_roles) {
    for (const r of body.notify_roles) {
      if (!ALLOWED_NOTIFY_ROLES.includes(r as typeof ALLOWED_NOTIFY_ROLES[number])) {
        return { ok: false, error: `Unknown notify_role: ${r}. Allowed: ${ALLOWED_NOTIFY_ROLES.join(', ')}` };
      }
    }
  }
  if (body.tags_to_apply) {
    for (const t of body.tags_to_apply) {
      if (!ALLOWED_TAGS.includes(t as typeof ALLOWED_TAGS[number])) {
        return { ok: false, error: `Unknown tag: ${t}. Allowed: ${ALLOWED_TAGS.join(', ')}` };
      }
    }
  }
  if (body.pipeline_stage !== undefined && body.pipeline_stage !== null) {
    if (!(ALLOWED_STAGES as readonly (string | null)[]).includes(body.pipeline_stage)) {
      return { ok: false, error: `Unknown pipeline_stage: ${body.pipeline_stage}. Allowed: ${ALLOWED_STAGES.filter(Boolean).join(', ')}` };
    }
  }

  return { ok: true };
}
