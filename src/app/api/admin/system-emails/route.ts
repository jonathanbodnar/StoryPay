/**
 * GET  /api/admin/system-emails        — list all templates (registry + saved overrides)
 * PATCH /api/admin/system-emails       — save overrides for an editable template
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import {
  SYSTEM_EMAIL_REGISTRY,
  SYSTEM_EMAIL_BY_KEY,
  type SystemEmailDef,
} from '@/lib/system-email-registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function isAdmin(): Promise<string | null> {
  const c = await cookies();
  const adminEmail = c.get('admin_email')?.value;
  if (!adminEmail) return null;
  const { data } = await supabaseAdmin
    .from('super_admins')
    .select('id')
    .eq('email', adminEmail)
    .maybeSingle();
  return data ? adminEmail : null;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const adminEmail = await isAdmin();
  if (!adminEmail) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Load all saved overrides
  const { data: saved } = await supabaseAdmin
    .from('system_email_templates')
    .select('key, subject, heading, body, button_text, updated_at, updated_by');

  type SavedRow = { key: string; subject: string; heading: string; body: string; button_text: string | null; updated_at: string; updated_by: string | null };
  const savedMap = new Map<string, SavedRow>(
    ((saved ?? []) as SavedRow[]).map((r) => [r.key, r]),
  );

  const templates = SYSTEM_EMAIL_REGISTRY.map((def: SystemEmailDef) => {
    const override = savedMap.get(def.key);
    return {
      key:          def.key,
      label:        def.label,
      description:  def.description,
      trigger:      def.trigger,
      schedule:     def.schedule ?? null,
      category:     def.category,
      editable:     def.editable,
      // Effective values (override > defaults)
      subject:      override?.subject     ?? def.defaults.subject,
      heading:      override?.heading     ?? def.defaults.heading,
      body:         override?.body        ?? def.defaults.body,
      button_text:  override?.button_text ?? def.defaults.button_text ?? null,
      // Meta
      is_customized: !!override,
      updated_at:    override?.updated_at ?? null,
      updated_by:    override?.updated_by ?? null,
      // Defaults snapshot (so the UI can show "reset to default")
      default_subject:     def.defaults.subject,
      default_heading:     def.defaults.heading,
      default_body:        def.defaults.body,
      default_button_text: def.defaults.button_text ?? null,
    };
  });

  return NextResponse.json({ templates });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

interface PatchBody {
  key: string;
  subject?: string;
  heading?: string;
  body?: string;
  button_text?: string | null;
  reset?: boolean;
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const adminEmail = await isAdmin();
  if (!adminEmail) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: PatchBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const def = SYSTEM_EMAIL_BY_KEY[body.key];
  if (!def) return NextResponse.json({ error: 'Unknown template key' }, { status: 404 });
  if (!def.editable) return NextResponse.json({ error: 'This template is not editable' }, { status: 403 });

  // Reset to defaults
  if (body.reset) {
    const { error } = await supabaseAdmin
      .from('system_email_templates')
      .delete()
      .eq('key', body.key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, reset: true });
  }

  // Upsert override
  const { error } = await supabaseAdmin
    .from('system_email_templates')
    .upsert(
      {
        key:         body.key,
        subject:     body.subject     ?? def.defaults.subject,
        heading:     body.heading     ?? def.defaults.heading,
        body:        body.body        ?? def.defaults.body,
        button_text: body.button_text !== undefined ? body.button_text : (def.defaults.button_text ?? null),
        updated_at:  new Date().toISOString(),
        updated_by:  adminEmail,
      },
      { onConflict: 'key' },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
