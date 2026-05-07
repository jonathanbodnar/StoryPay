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
import { sendEmail } from '@/lib/email';

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

  // Send invite email with login URL + initial credentials.
  // Errors here don't fail the API response — the member row is created either
  // way, and the inviter can always click "Reset password" to retry the email.
  let emailSent = false;
  let emailError: string | undefined;
  try {
    const result = await sendInviteEmail({
      to: email,
      firstName,
      password,
      isSuperAdmin,
    });
    emailSent = result.success;
    emailError = result.error;
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e);
    console.error('[team-members] invite email failed:', emailError);
  }

  return NextResponse.json({ member: data, emailSent, emailError }, { status: 201 });
}

async function sendInviteEmail(opts: {
  to: string;
  firstName: string;
  password: string;
  isSuperAdmin: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
  const loginUrl = `${baseUrl}/admin`;
  const access = opts.isSuperAdmin
    ? 'Super admin (full access to every tab + team management)'
    : 'Limited access — your assigned tabs only';

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Welcome to the StoryVenue admin</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:28px 32px 0;">
          <p style="margin:0;font-size:12px;letter-spacing:1.5px;color:#9ca3af;text-transform:uppercase;font-weight:600;">StoryVenue · Super Admin</p>
          <h1 style="margin:14px 0 4px;font-size:22px;color:#111827;font-weight:600;">Welcome aboard, ${escapeHtml(opts.firstName)}.</h1>
          <p style="margin:0;font-size:15px;color:#4b5563;line-height:1.55;">
            You've been invited to the StoryVenue super admin panel. Use the credentials below to sign in — please change your password the first time you log in.
          </p>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
            <tr><td style="padding:16px 18px;">
              <p style="margin:0 0 6px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Email</p>
              <p style="margin:0 0 14px;font-size:14px;color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(opts.to)}</p>
              <p style="margin:0 0 6px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Temporary password</p>
              <p style="margin:0;font-size:14px;color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(opts.password)}</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;">
          <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Access level</p>
          <p style="margin:0;font-size:14px;color:#111827;">${escapeHtml(access)}</p>
        </td></tr>
        <tr><td align="center" style="padding:0 32px 32px;">
          <a href="${loginUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;">Sign in to admin panel</a>
        </td></tr>
        <tr><td style="padding:0 32px 28px;border-top:1px solid #f3f4f6;">
          <p style="margin:18px 0 0;font-size:12px;color:#9ca3af;line-height:1.55;">
            If you didn't expect this invite, you can ignore this email — the account won't be active until you sign in. Questions? Reply to this message.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return sendEmail({
    to: opts.to,
    subject: 'Welcome to the StoryVenue admin panel',
    html,
    replyTo: process.env.ADMIN_REPLY_TO || undefined,
    headers: { 'X-Entity-Ref-ID': `storyvenue-admin-invite-${Date.now()}` },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
