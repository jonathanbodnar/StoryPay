import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { rateLimit, getClientIp, formatRetryAfter } from '@/lib/rate-limit';
import { checkPassword } from '@/lib/password-policy';
import {
  SUPPORT_SESSION_COOKIE,
  hashSupportPassword,
  signSupportSession,
  type SupportRole,
} from '@/lib/support/auth';
import { verifyAdminResetToken } from '../forgot/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/auth/reset
 *
 * Body: { token: string; password: string }
 *
 * Validates the signed admin reset token, bcrypt-hashes the new password,
 * updates support_team_members.password_hash, and signs the team member in
 * immediately by setting the support_session cookie.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`admin-reset:ip:${ip}`, 10, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many reset attempts. Try again in ${formatRetryAfter(rl.retryAfterMs)}.` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let token = '', password = '';
  try {
    const body = await req.json();
    token = (body?.token ?? '').trim();
    password = (body?.password ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!token) return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
  const pwCheck = checkPassword(password);
  if (!pwCheck.valid) {
    return NextResponse.json({ error: pwCheck.message }, { status: 400 });
  }

  const parsed = verifyAdminResetToken(token);
  if (!parsed) {
    return NextResponse.json(
      { error: 'This reset link has expired or is invalid. Please request a new one.' },
      { status: 400 },
    );
  }

  const { data: member, error: memberErr } = await supabaseAdmin
    .from('support_team_members')
    .select('id, email, name, role, active')
    .eq('id', parsed.memberId)
    .maybeSingle();

  if (memberErr || !member) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }
  if (!member.active) {
    return NextResponse.json(
      { error: 'This account is inactive. Contact your administrator.' },
      { status: 403 },
    );
  }

  const passwordHash = await hashSupportPassword(password);

  const { error: updateErr } = await supabaseAdmin
    .from('support_team_members')
    .update({ password_hash: passwordHash, last_login_at: new Date().toISOString() })
    .eq('id', member.id as string);

  if (updateErr) {
    console.error('[admin/reset] update failed:', updateErr.message);
    return NextResponse.json({ error: 'Could not update password. Please try again.' }, { status: 500 });
  }

  console.log('[admin/reset] password updated for team member:', member.id);

  const sessionToken = signSupportSession({
    sub:   member.id as string,
    email: member.email as string,
    name:  member.name as string,
    role:  (member.role as SupportRole) ?? 'support_agent',
  });

  const response = NextResponse.json({ ok: true, redirect: '/admin' });
  response.cookies.set(SUPPORT_SESSION_COOKIE, sessionToken, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 12,
  });
  // Never elevate a team member to the env super-admin via a stale cookie.
  response.cookies.set('admin_token', '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
  });
  return response;
}
