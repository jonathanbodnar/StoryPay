import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  SUPPORT_SESSION_COOKIE,
  signSupportSession,
  verifySupportPassword,
} from '@/lib/support/auth';
import { rateLimit, getClientIp, formatRetryAfter } from '@/lib/rate-limit';
import { secureCompare } from '@/lib/secure-compare';
import { issueMasterAdminToken } from '@/lib/admin-token';
import { sendEmail } from '@/lib/email';
import { buildEmailHtml, fillTemplate, type EmailTemplateRow } from '@/lib/email-templates';
import { SYSTEM_EMAIL_BY_KEY } from '@/lib/system-email-registry';
import crypto from 'crypto';

/**
 * Admin login — email + password, then OTP for the master super admin.
 *
 * Three paths, tried in order:
 *
 *   1. Master super admin — env-based credentials (ADMIN_EMAIL/ADMIN_PASSWORD,
 *      or legacy single ADMIN_SECRET as password). On success, instead of
 *      immediately issuing the admin_token cookie, we generate a 6-digit OTP,
 *      store it in admin_otp_tokens, email it to the admin, and return
 *      { step: 'otp_required' }. The token is only issued after OTP verification
 *      via /api/admin/auth/verify-otp.
 *
 *   2. Team member — DB lookup against support_team_members. On success sets
 *      the `support_session` cookie (signed JWT). Tab access is enforced
 *      separately via support_team_members.admin_tabs_allowed.
 */

interface LoginBody { email?: string; password?: string; secret?: string }

/** Generate a cryptographically random 6-digit OTP string (zero-padded). */
function generateOtp(): string {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, '0');
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const gate = rateLimit(`admin-login:${ip}`, 10, 10 * 60 * 1000);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${formatRetryAfter(gate.retryAfterMs)}.` },
      { status: 429 },
    );
  }

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
      masterValid = inputEmail === adminEmail.toLowerCase() && secureCompare(inputPassword, adminPassword);
    } else if (adminSecret) {
      masterValid = secureCompare(inputPassword, adminSecret);
    }
  } else if (body.secret !== undefined && adminSecret) {
    masterValid = secureCompare(body.secret, adminSecret);
  }

  if (masterValid) {
    // Generate OTP and store it (10-minute expiry).
    const code      = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Clear any old unused tokens before inserting a fresh one.
    await supabaseAdmin.from('admin_otp_tokens').delete().eq('used', false);

    const { error: insertErr } = await supabaseAdmin
      .from('admin_otp_tokens')
      .insert({ code, expires_at: expiresAt });

    // If the migration hasn't been applied yet (table missing), fall back to
    // direct login so the admin can get in and apply the migration.
    if (insertErr && (insertErr as { code?: string }).code === '42P01') {
      console.warn('[admin-otp] admin_otp_tokens table missing — bypassing OTP, run migration 196.');
      const resp = NextResponse.json({ success: true, identity: 'master' });
      resp.cookies.set('admin_token', issueMasterAdminToken(), {
        httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
      });
      return resp;
    }

    // Determine the email address to send to.
    const toEmail = adminEmail || process.env.ADMIN_NOTIFICATION_EMAIL || '';
    if (toEmail) {
      const def = SYSTEM_EMAIL_BY_KEY['admin_otp'];
      let subject     = def?.defaults.subject     ?? 'Your StoryVenue admin login code';
      let heading     = def?.defaults.heading     ?? 'Your admin login code';
      let bodyText    = def?.defaults.body        ?? '{{otp_code}}';
      let button_text = def?.defaults.button_text ?? null;

      // Load saved override from system_email_templates (if any).
      const { data: override } = await supabaseAdmin
        .from('system_email_templates')
        .select('subject, heading, body, button_text')
        .eq('key', 'admin_otp')
        .maybeSingle();
      if (override) {
        subject     = (override as any).subject     || subject;
        heading     = (override as any).heading     || heading;
        bodyText    = (override as any).body        || bodyText;
        button_text = (override as any).button_text !== undefined
          ? (override as any).button_text
          : button_text;
      }

      const tplRow: EmailTemplateRow = {
        type: 'admin_otp',
        subject,
        heading,
        body: bodyText,
        button_text: button_text ?? null,
        footer: null,
        enabled: true,
      };

      const html = buildEmailHtml({
        template: tplRow,
        vars: { otp_code: code },
        brandColor: '#1b1b1b',
        venueName: 'StoryVenue',
      });

      const resolvedSubject = fillTemplate(subject, { otp_code: code });

      await sendEmail({
        to: toEmail,
        subject: resolvedSubject,
        html,
      }).catch(err => console.error('[admin-otp] email send failed:', err));
    } else {
      // No email configured — log the code so the admin can still sign in locally.
      console.warn(`[admin-otp] No ADMIN_EMAIL set. OTP code: ${code}`);
    }

    return NextResponse.json({ step: 'otp_required' });
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
          httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
        });
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
