import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { rateLimitAny, getClientIp, formatRetryAfter } from '@/lib/rate-limit';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function sign(payload: string): string {
  const secret = process.env.ADMIN_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // A predictable signing secret would let anyone forge reset tokens for any
    // team member, so we hard-fail rather than fall back to a literal string.
    throw new Error(
      'ADMIN_SECRET (or NEXTAUTH_SECRET) is not configured. Admin password reset tokens cannot be signed.',
    );
  }
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Reset tokens for support/admin team members. Namespaced with an `admin:`
 * prefix so a venue reset token can never be replayed here (and vice versa).
 */
export function buildAdminResetToken(memberId: string): string {
  const exp = Date.now() + EXPIRY_MS;
  const payload = `admin:${memberId}:${exp}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function verifyAdminResetToken(token: string): { memberId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 4) return null;
    const [type, memberId, expStr, sig] = parts;
    if (type !== 'admin') return null;
    const payload = `${type}:${memberId}:${expStr}`;
    if (sign(payload) !== sig) return null;
    if (Date.now() > Number(expStr)) return null;
    return { memberId };
  } catch {
    return null;
  }
}

/**
 * POST /api/admin/auth/forgot
 *
 * Accepts { email } and, if a matching active team member exists, emails them
 * a password-reset link. Always returns 200 to prevent account enumeration.
 */
export async function POST(req: NextRequest) {
  let email = '';
  try {
    const body = await req.json();
    email = (body?.email ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (!email) return NextResponse.json({ ok: true });

  // Rate limit: per-IP (5/hr) AND per-email (3/hr). Always return ok:true.
  const ip = getClientIp(req);
  const rl = rateLimitAny([
    { key: `admin-forgot:ip:${ip}`,       limit: 5, windowMs: 60 * 60_000 },
    { key: `admin-forgot:email:${email}`, limit: 3, windowMs: 60 * 60_000 },
  ]);
  if (!rl.allowed) {
    console.log('[admin/forgot] rate limited:', email, formatRetryAfter(rl.retryAfterMs));
    return NextResponse.json({ ok: true });
  }

  const { data: member, error } = await supabaseAdmin
    .from('support_team_members')
    .select('id, name, email, active')
    .ilike('email', email)
    .maybeSingle();

  if (error) console.error('[admin/forgot] DB error:', error.message);

  // Only send for an existing, active team member. Master super-admin login is
  // env-based (no DB row) and cannot be reset through this flow.
  if (!member || !member.active) {
    return NextResponse.json({ ok: true });
  }

  const token = buildAdminResetToken(member.id as string);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.storyvenue.com';
  const resetUrl = `${appUrl}/reset-password/admin?token=${token}`;
  const name = (member.name as string | null)?.trim() || 'there';

  try {
    await sendEmail({
      to: member.email as string,
      subject: 'Reset your StoryVenue admin password',
      html: `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:22px;margin:0;font-weight:300">StoryVenue</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">Reset your admin password</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px">
      Hi ${name}, we received a request to reset the password for your
      StoryVenue admin account. Click the button below to choose a new
      password — this link expires in <strong>1 hour</strong>.
    </p>
    <div style="text-align:center;margin:0 0 32px">
      <a href="${resetUrl}"
        style="background-color:#1b1b1b;border-radius:10px;color:#ffffff;display:inline-block;font-family:'Open Sans',Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        <span style="color:#ffffff;text-decoration:none;">Reset Password</span>
      </a>
    </div>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 8px">
      Or copy and paste this link into your browser:
    </p>
    <p style="color:#1b1b1b;font-size:12px;word-break:break-all;margin:0 0 24px">
      ${resetUrl}
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
      If you didn&apos;t request a password reset, you can safely ignore this email.
    </p>
  </div>
</div>`,
    });
    console.log('[admin/forgot] reset email sent to:', email);
  } catch (e) {
    console.error('[admin/forgot] sendEmail failed:', e);
  }

  return NextResponse.json({ ok: true });
}
