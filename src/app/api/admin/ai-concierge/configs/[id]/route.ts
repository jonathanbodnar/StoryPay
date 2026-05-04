/**
 * Per-version detail / metadata edit / delete.
 *
 *   GET    → full version row (same shape as the list payload).
 *   PATCH  → narrow metadata edit (notes only). Prompt content fields
 *            (personality / goals / guardrails / prohibited_topics /
 *            message_constraints / system_prompt_template) are NOT editable
 *            here — for prompt changes the operator creates a new version.
 *            This keeps the version history honest.
 *   DELETE → permanent removal. Refused on the active version (operator
 *            must activate another version first).
 *
 * Active flips happen on the dedicated /activate route so they're atomic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { clearAiConfigCache } from '@/lib/ai-concierge/prompt-builder';

export const dynamic = 'force-dynamic';

interface PatchBody {
  notes?: string | null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('ai_config')
    .select('id, version, is_active, personality, goals, guardrails, prohibited_topics, message_constraints, system_prompt_template, notes, created_by, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  return NextResponse.json({ row: data });
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: PatchBody;
  try { body = await request.json() as PatchBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Whitelist: only `notes` is editable on an existing row. Everything else
  // is immutable to preserve the audit trail (operator creates a new
  // version for any prompt-content change).
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.notes !== undefined) update.notes = body.notes;

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No editable fields supplied (only "notes" can be patched on an existing version)' }, { status: 400 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('ai_config')
    .update(update)
    .eq('id', id)
    .select('id, version, is_active, personality, goals, guardrails, prohibited_topics, message_constraints, system_prompt_template, notes, created_by, created_at, updated_at')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  clearAiConfigCache();
  return NextResponse.json({ row: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Refuse to delete the active version — operator must explicitly activate
  // another version first. Avoids leaving the cron with no config.
  const { data: existing } = await supabaseAdmin
    .from('ai_config')
    .select('id, is_active')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  if (existing.is_active) {
    return NextResponse.json({
      error: 'Cannot delete the active version. Activate another version first.',
    }, { status: 422 });
  }

  const { error } = await supabaseAdmin
    .from('ai_config')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  clearAiConfigCache();
  return NextResponse.json({ ok: true });
}
