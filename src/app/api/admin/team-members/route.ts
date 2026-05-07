/**
 * GET  — list all admin team members (returns extended profile fields)
 * POST — invite/create a new admin team member
 *
 * Both require canManageTeam = true (master super admin OR is_super_admin team member).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { hashSupportPassword } from '@/lib/support/auth';
import { getAdminIdentity } from '@/lib/admin-identity';
import { ADMIN_TAB_KEY_SET } from '@/lib/admin-tabs-registry';
import { ensureAdminTeamSchema } from '@/lib/admin-team-schema-ensure';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CreateBody {
  first_name?: string;
  last_name?: string;
  email?: string;
  password?: string;
  role?: string;
  is_super_admin?: boolean;
  admin_tabs_allowed?: Record<string, boolean>;
  active?: boolean;
}

function sanitizeAdminTabs(input: unknown): Record<string, boolean> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (ADMIN_TAB_KEY_SET.has(k) && v === true) out[k] = true;
  }
  return out;
}

export async function GET() {
  const id = await getAdminIdentity();
  if (!id.canManageTeam) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try { await ensureAdminTeamSchema(); } catch (e) {
    return NextResponse.json({ error: `Schema setup failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
  const { data, error } = await supabaseAdmin
    .from('support_team_members')
    .select(
      'id, email, name, first_name, last_name, avatar_url, role, active, is_super_admin, admin_tabs_allowed, last_login_at, created_at',
    )
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hide the synthetic super-admin row (used only for FK attribution)
  const filtered = (data ?? []).filter(
    (m) => !String(m.email ?? '').endsWith('@storyvenue.internal'),
  );
  return NextResponse.json({ members: filtered });
}

export async function POST(request: NextRequest) {
  const id = await getAdminIdentity();
  if (!id.canManageTeam) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try { await ensureAdminTeamSchema(); } catch (e) {
    return NextResponse.json({ error: `Schema setup failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  let body: CreateBody = {};
  try { body = (await request.json()) as CreateBody; } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const firstName = (body.first_name ?? '').trim();
  const lastName  = (body.last_name  ?? '').trim();
  const email     = (body.email      ?? '').trim().toLowerCase();
  const password  = body.password ?? '';

  if (!firstName) return NextResponse.json({ error: 'First name is required' }, { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const role = body.role === 'support_admin' ? 'support_admin' : 'support_agent';
  const isSuperAdmin = body.is_super_admin === true;
  const tabs = sanitizeAdminTabs(body.admin_tabs_allowed);
  const fullName = `${firstName} ${lastName}`.trim() || firstName;

  const password_hash = await hashSupportPassword(password);

  const { data, error } = await supabaseAdmin
    .from('support_team_members')
    .insert({
      email,
      first_name: firstName,
      last_name: lastName || null,
      name: fullName,
      password_hash,
      role,
      is_super_admin: isSuperAdmin,
      admin_tabs_allowed: tabs,
      active: body.active === false ? false : true,
    })
    .select('id, email, name, first_name, last_name, role, active, is_super_admin, created_at')
    .single();

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: 'A team member with that email already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ member: data }, { status: 201 });
}
