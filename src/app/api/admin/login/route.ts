import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  SUPPORT_SESSION_COOKIE,
  signSupportSession,
  verifySupportPassword,
} from '@/lib/support/auth';

/**
 * Admin login — email + password.
 *
 * Two paths, tried in order:
 *
 *   1. Master super admin — env-based credentials (ADMIN_EMAIL/ADMIN_PASSWORD,
 *      or legacy single ADMIN_SECRET as password). On success sets the
 *      `admin_token` cookie containing ADMIN_SECRET (full access).
 *
 *   2. Team member — DB lookup against support_team_members. On success sets
 *      the `support_session` cookie (signed JWT). Tab access is enforced
 *      separately via support_team_members.admin_tabs_allowed.
 */

interface LoginBody { email?: string; password?: string; secret?: string }

export async function POST(request: Request) {
  let body: LoginBody = {};
  try { body = (await request.json()) as LoginBody; } catch { /* empty */ }

  const adminEmail    = process.env.ADMIN_EMAIL ?? '';
  const adminPassword = process.env.ADMIN_PASSWORD ?? '';
  const adminSecret   = process.env.ADMIN_SECRET ?? '';
  const inputEmail    = (body.email ?? '').trim().toLowerCase();
  const inputPassword = body.password ?? '';

  // ─── 1. Master super admin (env) ─────────────────────────────────────────
  let masterValid = false;
  if (body.email !== undefined || body.password !== undefined) {
    if (adminEmail && adminPassword) {
      masterValid = inputEmail === adminEmail.toLowerCase() && inputPassword === adminPassword;
    } else if (adminSecret) {
      masterValid = inputPassword === adminSecret;
    }
  } else if (body.secret !== undefined && adminSecret) {
    masterValid = body.secret === adminSecret;
  }

  if (masterValid) {
    const response = NextResponse.json({ success: true, identity: 'master' });
    response.cookies.set('admin_token', adminSecret, {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
    });
    // Clear any stale team member session so the env super admin takes over cleanly.
    response.cookies.set(SUPPORT_SESSION_COOKIE, '', {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
    });
    return response;
  }

  // ─── 2. Team member (DB lookup) ──────────────────────────────────────────
  if (inputEmail && inputPassword) {
    const { data: member } = await supabaseAdmin
      .from('support_team_members')
      .select('id, email, name, role, password_hash, active')
      .ilike('email', inputEmail)
      .maybeSingle();

    if (member && member.active && typeof member.password_hash === 'string') {
      const ok = await verifySupportPassword(inputPassword, member.password_hash as string);
      if (ok) {
        const token = signSupportSession({
          sub: member.id as string,
          email: member.email as string,
          name: member.name as string,
          role: (member.role as 'support_agent' | 'support_admin') ?? 'support_agent',
        });
        await supabaseAdmin
          .from('support_team_members')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', member.id as string);

        const response = NextResponse.json({ success: true, identity: 'team_member' });
        response.cookies.set(SUPPORT_SESSION_COOKIE, token, {
          httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 12,
        });
        // Make sure the env-based super-admin cookie is cleared so we don't
        // accidentally elevate this team member to full access.
        response.cookies.set('admin_token', '', {
          httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
        });
        return response;
      }
    }
  }

  return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_token', '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
  });
  response.cookies.set(SUPPORT_SESSION_COOKIE, '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
  });
  return response;
}
