/**
 * /api/admin/me
 *
 * GET   — return the current admin identity (master super admin or team member).
 * PATCH — update the current team member's own first/last name, email, password.
 *         The master env-based super admin cannot edit themselves through this
 *         endpoint (their credentials live in env vars).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';
import { hashSupportPassword, verifySupportPassword } from '@/lib/support/auth';
import { ADMIN_TABS } from '@/lib/admin-tabs-registry';
import { ensureAdminTeamSchema } from '@/lib/admin-team-schema-ensure';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  // Self-heal schema before identity resolution touches the new columns.
  try { await ensureAdminTeamSchema(); } catch { /* fall through; identity may still resolve for master admin */ }

  const id = await getAdminIdentity();
  if (!id.isMasterSuperAdmin && !id.member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    isMasterSuperAdmin: id.isMasterSuperAdmin,
    canManageTeam: id.canManageTeam,
    allowedTabs: Array.from(id.allowedTabs),
    allTabs: ADMIN_TABS,
    member: id.member,
  });
}

interface PatchBody {
  first_name?: string;
  last_name?: string;
  email?: string;
  current_password?: string;
  new_password?: string;
}

export async function PATCH(request: NextRequest) {
  const id = await getAdminIdentity();
  if (id.isMasterSuperAdmin) {
    return NextResponse.json(
      { error: 'Master super admin credentials are managed via environment variables and cannot be edited here.' },
      { status: 403 },
    );
  }
  if (!id.member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
  if (firstName !== undefined || lastName !== undefined) {
    const fn = firstName ?? id.member.first_name ?? '';
    const ln = lastName  ?? id.member.last_name  ?? '';
    update.name = `${fn} ${ln}`.trim() || fn;
  }

  if (typeof body.email === 'string') {
    const e = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    update.email = e;
  }

  // Password change requires current password unless the user is a super admin
  // and the row is themselves (basic safety: prevents accidental password takeover
  // if an attacker gets a stolen session cookie).
  if (typeof body.new_password === 'string' && body.new_password.length > 0) {
    if (body.new_password.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
    }
    const current = body.current_password ?? '';
    const { data: row } = await supabaseAdmin
      .from('support_team_members')
      .select('password_hash')
      .eq('id', id.member.id)
      .single();
    if (!row || !current) {
      return NextResponse.json({ error: 'Current password is required to change your password' }, { status: 400 });
    }
    const ok = await verifySupportPassword(current, row.password_hash as string);
    if (!ok) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }
    update.password_hash = await hashSupportPassword(body.new_password);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('support_team_members')
    .update(update)
    .eq('id', id.member.id)
    .select('id, email, name, first_name, last_name, avatar_url, role, is_super_admin')
    .single();

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: 'That email is already in use' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ member: data });
}
