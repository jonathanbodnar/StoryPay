import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { hashSupportPassword } from '@/lib/support/auth';
import { sendEmail } from '@/lib/email';
import { CONTACT_TYPES, type ContactType } from '@/lib/admin-contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONTACT_TYPE_SET = new Set<string>(CONTACT_TYPES);

interface ResetBody {
  /** 'email' to send a reset link, 'set' to set a new password directly. */
  mode?: 'email' | 'set';
  /** Required when mode='set'. */
  newPassword?: string;
}

/**
 * POST /api/admin/contacts/[type]/[id]/reset-password
 *
 * Issue a new password for a contact, either by:
 *   - mode='email' (default) — email them a recovery / magic link.
 *   - mode='set'             — admin sets a new password directly. The contact
 *                              will need to use the new password next time.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { type, id } = await params;
  if (!CONTACT_TYPE_SET.has(type)) {
    return NextResponse.json({ error: 'Unknown contact type' }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const t = type as ContactType;

  let body: ResetBody = {};
  try { body = (await req.json()) as ResetBody; } catch { /* allow empty body */ }
  const mode = body.mode ?? 'email';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';

  // ── couple — auth.users-backed ──────────────────────────────────────────
  if (t === 'couple') {
    const { data: userResp, error } = await supabaseAdmin.auth.admin.getUserById(id);
    if (error || !userResp?.user?.email) {
      return NextResponse.json({ error: 'Couple not found' }, { status: 404 });
    }
    const email = userResp.user.email;

    if (mode === 'set') {
      const pw = body.newPassword ?? '';
      if (pw.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
      }
      const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(id, { password: pw });
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
      return NextResponse.json({ ok: true, mode: 'set' });
    }

    const { data, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${appUrl}/couple/reset-password` },
    });
    if (linkErr || !data?.properties?.action_link) {
      return NextResponse.json({ error: linkErr?.message ?? 'Could not generate link' }, { status: 500 });
    }
    const link = data.properties.action_link;

    try {
      await sendEmail({
        to: email,
        subject: 'Reset your StoryVenue password',
        html: resetEmailHtml({ resetUrl: link, appUrl, name: 'there' }),
      });
    } catch (e) {
      console.warn('[contacts/reset-password] sendEmail failed:', e);
    }
    return NextResponse.json({ ok: true, mode: 'email', sentTo: email, url: link });
  }

  // ── admin team — set password_hash directly ─────────────────────────────
  if (t === 'admin_team') {
    if (mode === 'set') {
      const pw = body.newPassword ?? '';
      if (pw.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
      }
      const password_hash = await hashSupportPassword(pw);
      const { error } = await supabaseAdmin
        .from('support_team_members').update({ password_hash }).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, mode: 'set' });
    }
    // 'email' mode for admin team: generate a random password, email it.
    const tmp = randomPassword();
    const password_hash = await hashSupportPassword(tmp);
    const { data: member, error } = await supabaseAdmin
      .from('support_team_members')
      .update({ password_hash })
      .eq('id', id)
      .select('email, name')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!member?.email) return NextResponse.json({ error: 'Admin team member has no email' }, { status: 400 });
    try {
      await sendEmail({
        to: member.email as string,
        subject: 'Your StoryVenue admin password was reset',
        html: adminResetHtml({ appUrl, name: (member.name as string) || 'there', tempPassword: tmp }),
      });
    } catch (e) {
      console.warn('[contacts/reset-password admin_team] sendEmail failed:', e);
    }
    return NextResponse.json({ ok: true, mode: 'email', sentTo: member.email });
  }

  // ── venue owner — regenerate magic login token, optionally email it ────
  if (t === 'venue_owner') {
    const { data: venue, error } = await supabaseAdmin
      .from('venues').select('id, name, email, owner_id').eq('id', id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

    // Rotate venue login_token (legacy magic link path)
    const { data: updated, error: upErr } = await supabaseAdmin
      .from('venues')
      .update({ login_token: crypto.randomUUID() })
      .eq('id', id)
      .select('login_token')
      .single();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const loginUrl = updated?.login_token ? `${appUrl}/login/${updated.login_token}` : null;

    // If the venue has an auth user too, send them a Supabase recovery link
    const ownerId = (venue as { owner_id?: string | null }).owner_id;
    let supabaseResetUrl: string | null = null;
    const email = (venue as { email?: string | null }).email;
    if (ownerId && email) {
      try {
        const { data } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${appUrl}/reset-password` },
        });
        supabaseResetUrl = data?.properties?.action_link ?? null;
      } catch {}
    }

    if (mode === 'email' && email && loginUrl) {
      try {
        await sendEmail({
          to: email,
          subject: 'StoryVenue login link',
          html: venueLoginEmailHtml({
            appUrl,
            venueName: (venue as { name?: string | null }).name ?? 'your venue',
            loginUrl,
            supabaseResetUrl,
          }),
        });
      } catch (e) {
        console.warn('[contacts/reset-password venue_owner] sendEmail failed:', e);
      }
    }
    return NextResponse.json({ ok: true, mode, loginUrl, supabaseResetUrl });
  }

  return NextResponse.json(
    { error: 'This contact type does not have a password to reset.' },
    { status: 400 },
  );
}

function randomPassword(): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 14; i++) s += charset[Math.floor(Math.random() * charset.length)];
  return s;
}

function resetEmailHtml({ resetUrl, appUrl, name }: { resetUrl: string; appUrl: string; name: string }) {
  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:22px;margin:0;font-weight:300">StoryVenue</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">Reset your password</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px">
      Hi ${name}, the StoryVenue team triggered a password reset for your account.
      Click the button below to set a new password. This link expires in 1 hour.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${resetUrl}"
        style="background-color:#1b1b1b;border-radius:10px;color:#ffffff;display:inline-block;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        Reset Password
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0">
      Or paste this URL into your browser:<br>
      <a href="${resetUrl}" style="color:#1b1b1b;text-decoration:underline;word-break:break-all;">${resetUrl}</a>
    </p>
  </div>
</div>
<p style="color:#9ca3af;font-size:11px;text-align:center;margin:16px 0 0">
  <a href="${appUrl}" style="color:#9ca3af;text-decoration:underline;">StoryVenue</a>
</p>`;
}

function adminResetHtml({ appUrl, name, tempPassword }: { appUrl: string; name: string; tempPassword: string }) {
  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:22px;margin:0;font-weight:300">StoryVenue Admin</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">Your password was reset</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px">
      Hi ${name}, the StoryVenue super-admin team reset your admin password. Use the
      temporary password below to sign in, then change it from the My Profile page.
    </p>
    <div style="background:#f3f4f6;border-radius:8px;padding:16px 20px;margin:16px 0;font-family:monospace;font-size:18px;color:#111827;text-align:center;letter-spacing:1px">
      ${tempPassword}
    </div>
    <div style="text-align:center;margin:32px 0">
      <a href="${appUrl}/admin/login"
        style="background-color:#1b1b1b;border-radius:10px;color:#ffffff;display:inline-block;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        Open admin login
      </a>
    </div>
  </div>
</div>`;
}

function venueLoginEmailHtml({
  appUrl, venueName, loginUrl, supabaseResetUrl,
}: { appUrl: string; venueName: string; loginUrl: string; supabaseResetUrl: string | null }) {
  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:22px;margin:0;font-weight:300">StoryVenue</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">A new login link for ${venueName}</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px">
      Use the link below to sign in to StoryVenue. This link is unique to you — no password needed.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${loginUrl}"
        style="background-color:#1b1b1b;border-radius:10px;color:#ffffff;display:inline-block;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        Log In to StoryVenue
      </a>
    </div>
    ${supabaseResetUrl ? `
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
      <p style="color:#6b7280;font-size:13px;line-height:1.7;margin:0">
        Prefer a password? <a href="${supabaseResetUrl}" style="color:#1b1b1b">Click here to set one</a>.
      </p>` : ''}
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:24px 0 0">
      <a href="${appUrl}" style="color:#9ca3af;text-decoration:underline;">StoryVenue</a>
    </p>
  </div>
</div>`;
}
