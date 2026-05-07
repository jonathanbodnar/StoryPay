/**
 * POST /api/admin/team-members/[id]/resend-invite
 *
 * Resends the welcome / login email to an existing team member. Optionally
 * accepts a `password` field — if provided, the team member's password is
 * reset to that value before the email is sent. Otherwise the email is sent
 * with a fresh, randomly generated temporary password.
 *
 * Use this when the original invite email never arrived or got lost.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { hashSupportPassword } from '@/lib/support/auth';
import { getAdminIdentity } from '@/lib/admin-identity';
import { sendAdminInviteEmail } from '@/lib/admin-team-invite-email';
import { ensureAdminTeamSchema } from '@/lib/admin-team-schema-ensure';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body { password?: string }

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getAdminIdentity();
  if (!me.canManageTeam) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try { await ensureAdminTeamSchema(); } catch { /* fall through */ }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: Body = {};
  try { body = (await request.json()) as Body; } catch { /* empty body ok */ }

  const { data: member } = await supabaseAdmin
    .from('support_team_members')
    .select('id, email, first_name, name, is_super_admin, active')
    .eq('id', id)
    .maybeSingle();

  if (!member) return NextResponse.json({ error: 'Team member not found' }, { status: 404 });

  const password = body.password && body.password.length >= 8 ? body.password : generatePassword();
  const password_hash = await hashSupportPassword(password);

  const { error: updErr } = await supabaseAdmin
    .from('support_team_members')
    .update({ password_hash, active: true })
    .eq('id', id);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const firstName =
    (member.first_name as string | null) ||
    (member.name as string | null)?.split(' ')[0] ||
    'there';

  const result = await sendAdminInviteEmail({
    to: member.email as string,
    firstName,
    password,
    isSuperAdmin: member.is_super_admin === true,
    isReinvite: true,
  });

  return NextResponse.json({
    emailSent: result.success,
    emailError: result.error,
    // Surface the new password so the inviter can copy/paste it manually
    // if the email send fails.
    password: result.success ? undefined : password,
  });
}
