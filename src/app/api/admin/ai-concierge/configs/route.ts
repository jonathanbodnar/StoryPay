/**
 * AI Concierge prompt-config CRUD (list + create new version).
 *
 *   GET  → all versions, ordered version DESC, with the active version
 *          flagged. The full template body is included on each row so the
 *          editor doesn't need a follow-up GET to populate.
 *   POST → create a NEW version. Auto-assigns version = (max + 1).
 *          Defaults to is_active=false — operator activates explicitly.
 *
 * Versioning is append-only on this route. PATCH on /configs/[id] handles
 * narrow metadata edits (notes only); for prompt-content changes the
 * operator creates a new version. Rationale: the cron is reading the
 * active config; silent edits to it would be production-changing without
 * an audit trail. Append-only versioning gives us instant rollback.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { clearAiConfigCache } from '@/lib/ai-concierge/prompt-builder';

export const dynamic = 'force-dynamic';

interface OutreachQuestion {
  text:      string;
  category?: string;
  priority?: number;
}

interface AiConfigRow {
  id:                       string;
  version:                  number;
  is_active:                boolean;
  personality:              string;
  goals:                    string;
  guardrails:               string;
  prohibited_topics:        string;
  message_constraints:      Record<string, unknown>;
  system_prompt_template:   string;
  outreach_questions:       OutreachQuestion[];
  notes:                    string | null;
  created_by:               string | null;
  created_at:               string;
  updated_at:               string;
}

interface CreateBody {
  personality?:            string;
  goals?:                  string;
  guardrails?:             string;
  prohibited_topics?:      string;
  message_constraints?:    Record<string, unknown>;
  system_prompt_template?: string;
  outreach_questions?:     OutreachQuestion[];
  notes?:                  string | null;
  /** Source-version to clone from. If provided we copy fields from that
   *  row first, then overlay anything in the body. Convenience for the
   *  "duplicate to new version" UI. */
  cloneFromVersionId?:     string;
}

/**
 * Defensive validator. Strips malformed entries, normalizes shape, caps
 * length per item and pool size to avoid blowing past the model's
 * context budget on a runaway list.
 */
export function sanitizeOutreachQuestions(input: unknown): OutreachQuestion[] {
  if (!Array.isArray(input)) return [];
  const out: OutreachQuestion[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (!text) continue;
    const entry: OutreachQuestion = { text: text.slice(0, 280) };
    if (typeof r.category === 'string' && r.category.trim()) {
      entry.category = r.category.trim().slice(0, 60);
    }
    if (typeof r.priority === 'number' && Number.isFinite(r.priority)) {
      entry.priority = Math.max(-100, Math.min(100, Math.floor(r.priority)));
    }
    out.push(entry);
    if (out.length >= 100) break;  // hard cap on pool size
  }
  return out;
}

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Try the wider select with outreach_questions; fall back if migration 101
  // hasn't run yet so the editor still loads.
  let { data, error } = await supabaseAdmin
    .from('ai_config')
    .select('id, version, is_active, personality, goals, guardrails, prohibited_topics, message_constraints, system_prompt_template, outreach_questions, notes, created_by, created_at, updated_at')
    .order('version', { ascending: false });
  if (error && error.code === '42703') {
    const retry = await supabaseAdmin
      .from('ai_config')
      .select('id, version, is_active, personality, goals, guardrails, prohibited_topics, message_constraints, system_prompt_template, notes, created_by, created_at, updated_at')
      .order('version', { ascending: false });
    error = retry.error;
    data  = retry.data as typeof data;
  }

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({
        error: 'ai_config table missing — run /api/admin/run-migration-098 first',
        schemaMissing: true,
      }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as AiConfigRow[];
  const active = rows.find((r) => r.is_active) ?? null;

  return NextResponse.json({ rows, activeId: active?.id ?? null });
}

// ── POST ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: CreateBody;
  try { body = await request.json() as CreateBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Optional: clone from an existing version
  let base: Partial<AiConfigRow> = {};
  if (body.cloneFromVersionId) {
    let { data: src, error: srcErr } = await supabaseAdmin
      .from('ai_config')
      .select('personality, goals, guardrails, prohibited_topics, message_constraints, system_prompt_template, outreach_questions, notes')
      .eq('id', body.cloneFromVersionId)
      .maybeSingle();
    if (srcErr && srcErr.code === '42703') {
      const retry = await supabaseAdmin
        .from('ai_config')
        .select('personality, goals, guardrails, prohibited_topics, message_constraints, system_prompt_template, notes')
        .eq('id', body.cloneFromVersionId)
        .maybeSingle();
      srcErr = retry.error;
      src    = retry.data as typeof src;
    }
    if (srcErr) return NextResponse.json({ error: srcErr.message }, { status: 500 });
    if (!src)   return NextResponse.json({ error: 'cloneFromVersionId not found' }, { status: 404 });
    base = src as Partial<AiConfigRow>;
  }

  // Merge base + body. Body values win.
  const personality           = body.personality           ?? base.personality           ?? '';
  const goals                 = body.goals                 ?? base.goals                 ?? '';
  const guardrails            = body.guardrails            ?? base.guardrails            ?? '';
  const prohibited_topics     = body.prohibited_topics     ?? base.prohibited_topics     ?? '';
  const message_constraints   = body.message_constraints   ?? base.message_constraints   ?? {};
  const system_prompt_template = body.system_prompt_template ?? base.system_prompt_template ?? '';
  const outreach_questions    = sanitizeOutreachQuestions(body.outreach_questions ?? base.outreach_questions ?? []);
  const notes                 = body.notes ?? base.notes ?? null;

  // JSON guard for message_constraints (in case the editor sends a string)
  if (typeof message_constraints !== 'object' || Array.isArray(message_constraints) || message_constraints === null) {
    return NextResponse.json({ error: 'message_constraints must be a JSON object' }, { status: 422 });
  }

  // Required content guard — empty template produces empty prompts
  if (!system_prompt_template.trim()) {
    return NextResponse.json({ error: 'system_prompt_template cannot be empty' }, { status: 422 });
  }

  // Auto-assign next version number
  const { data: maxRow } = await supabaseAdmin
    .from('ai_config')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (maxRow?.version ?? 0) + 1;

  // Try INSERT including outreach_questions. If migration 101 hasn't run,
  // retry without it so v1 of the editor still works.
  let { data: inserted, error: insErr } = await supabaseAdmin
    .from('ai_config')
    .insert({
      version:                nextVersion,
      is_active:              false,
      personality,
      goals,
      guardrails,
      prohibited_topics,
      message_constraints,
      system_prompt_template,
      outreach_questions,
      notes,
      created_by:             'admin',
    })
    .select('id, version, is_active, personality, goals, guardrails, prohibited_topics, message_constraints, system_prompt_template, outreach_questions, notes, created_by, created_at, updated_at')
    .single();

  if (insErr && insErr.code === '42703') {
    const retry = await supabaseAdmin
      .from('ai_config')
      .insert({
        version:                nextVersion,
        is_active:              false,
        personality,
        goals,
        guardrails,
        prohibited_topics,
        message_constraints,
        system_prompt_template,
        notes,
        created_by:             'admin',
      })
      .select('id, version, is_active, personality, goals, guardrails, prohibited_topics, message_constraints, system_prompt_template, notes, created_by, created_at, updated_at')
      .single();
    insErr   = retry.error;
    inserted = retry.data as typeof inserted;
  }

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // Cache invalidation: a new version doesn't change the active row, but
  // belt-and-suspenders so the operator always sees fresh data on this
  // node after any write.
  clearAiConfigCache();

  return NextResponse.json({ row: inserted as AiConfigRow }, { status: 201 });
}
