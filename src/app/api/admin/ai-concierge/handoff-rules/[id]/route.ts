/**
 * Per-rule mutate / delete.
 *
 *   PATCH  → partial update; runs the same validation as POST for any
 *            fields that are present.
 *   DELETE → permanently removes the rule. (Use PATCH { is_active: false }
 *            for a soft delete.)
 *
 * The seeded starter rules from migration 098 are NOT specially protected
 * here — the operator owns this table and may delete or rewrite anything.
 * The migration is idempotent ("INSERT … WHERE NOT EXISTS") so re-running
 * it won't restore deleted rules.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { clearHandoffRulesCache } from '@/lib/ai-concierge/handoff-rules';
import { validateRuleBody } from '../route';

export const dynamic = 'force-dynamic';

interface PatchBody {
  rule_type?:      'keyword' | 'intent';
  trigger_value?:  string;
  action?:         'opt_out' | 'stop_and_handoff' | 'mark_not_interested';
  notify_roles?:   string[];
  tags_to_apply?:  string[];
  pipeline_stage?: string | null;
  is_active?:      boolean;
  description?:    string | null;
  position?:       number;
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing rule id' }, { status: 400 });

  let body: PatchBody;
  try { body = await request.json() as PatchBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Run validation only on fields present. validateRuleBody requires the
  // core trio (rule_type/action/trigger_value), so for partial patches that
  // touch a single optional field we skip validation. When the operator
  // edits the trigger or rule type we DO need to revalidate against the
  // existing row to ensure compatibility — load it first.
  if (body.rule_type !== undefined || body.trigger_value !== undefined || body.action !== undefined) {
    const { data: existing } = await supabaseAdmin
      .from('handoff_rules')
      .select('rule_type, trigger_value, action')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    const merged = {
      rule_type:     body.rule_type     ?? existing.rule_type,
      trigger_value: body.trigger_value ?? existing.trigger_value,
      action:        body.action        ?? existing.action,
      notify_roles:  body.notify_roles,
      tags_to_apply: body.tags_to_apply,
      pipeline_stage: body.pipeline_stage,
    };
    const v = validateRuleBody(merged);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 422 });
  }

  // Build the update payload (only fields actually present)
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['rule_type', 'trigger_value', 'action', 'notify_roles', 'tags_to_apply', 'pipeline_stage', 'is_active', 'description', 'position'] as const) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  if (typeof update.trigger_value === 'string') {
    update.trigger_value = (update.trigger_value as string).trim();
  }

  const { data: updated, error } = await supabaseAdmin
    .from('handoff_rules')
    .update(update)
    .eq('id', id)
    .select('id, rule_type, trigger_value, action, notify_roles, tags_to_apply, pipeline_stage, is_active, position, description, created_at, updated_at')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

  clearHandoffRulesCache();
  return NextResponse.json({ rule: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing rule id' }, { status: 400 });

  const { error, count } = await supabaseAdmin
    .from('handoff_rules')
    .delete({ count: 'exact' })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

  clearHandoffRulesCache();
  return NextResponse.json({ ok: true });
}
