/**
 * PATCH  — update a team member (name, email, role, is_super_admin, admin_tabs_allowed,
 *          active, password)
 * DELETE — soft-delete (sets active=false; rows are kept for FK integrity)
 *
 * Requires canManageTeam = true.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { hashSupportPassword } from '@/lib/support/auth';
import { getAdminIdentity } from '@/lib/admin-identity';
import { ADMIN_TAB_KEY_SET } from '@/lib/admin-tabs-registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sanitizeAdminTabs(input: unknown): Record<string, boolean> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (ADMIN_TAB_KEY_SET.has(k) && v === true) out[k] = true;
  }
  return out;
}

interface PatchBody {
  first_name?: string;
  last_name?: string;
  email?: string;
  password?: string;
  role?: string;
  is_super_admin?: boolean;
  admin_tabs_allowed?: Record<string, boolean>;
  active?: boolean;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getAdminIdentity();
  if (!me.canManageTeam) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: PatchBody = {};
  try { body = (await request.json()) as PatchBody; } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  let firstName: string | undefined;
  let lastName: string | undefined;

  if (typeof body.first_name === 'string') {
    firstName = body.first_name.trim();
    if (!firstName) return NextResponse.json({ error: 'First name cannot be empty' }, { status: 400 });
    update.first_name = firstName;
  }
  if (typeof body.last_name === 'string') {
    lastName = body.last_name.trim();
    update.last_name = lastName || null;
  }
  // Keep `name` in sync when first/last name are touched
  if (firstName !== undefined || lastName !== undefined) {
    const { data: existing } = await supabaseAdmin
      .from('support_team_members')
      .select('first_name, last_name')
      .eq('id', id)
      .maybeSingle();
    const fn = firstName ?? (existing?.first_name as string | null) ?? '';
    const ln = lastName ?? (existing?.last_name as string | null) ?? '';
    update.name = `${fn} ${ln}`.trim() || fn;
  }

  if (typeof body.email === 'string') {
    const e = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    update.email = e;
  }

  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    update.password_hash = await hashSupportPassword(body.password);
  }

  if (body.role === 'support_admin' || body.role === 'support_agent') {
    update.role = body.role;
  }

  if (typeof body.is_super_admin === 'boolean') {
    update.is_super_admin = body.is_super_admin;
  }

  if (body.admin_tabs_allowed !== undefined) {
    update.admin_tabs_allowed = sanitizeAdminTabs(body.admin_tabs_allowed);
  }

  if (typeof body.active === 'boolean') {
    update.active = body.active;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('support_team_members')
    .update(update)
    .eq('id', id)
    .select('id, email, name, first_name, last_name, avatar_url, role, active, is_super_admin, admin_tabs_allowed, last_login_at, created_at')
    .single();

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: 'A team member with that email already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ member: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getAdminIdentity();
  if (!me.canManageTeam) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Soft delete: set active=false instead of removing the row, so any
  // FK references (sent_by_support_user_id on conversation_messages, etc.)
  // remain valid for historical attribution.
  const { error } = await supabaseAdmin
    .from('support_team_members')
    .update({ active: false })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
