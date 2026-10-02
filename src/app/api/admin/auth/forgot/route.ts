import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildSystemEmail } from '@/lib/email-templates';
import { rateLimitAny, getClientIp, formatRetryAfter, perVisitorLimit } from '@/lib/rate-limit';
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
 * The link is tied to the member's current password: once the password
 * changes, every earlier link stops working, so a link works once.
 */
function passwordFingerprint(passwordHash: string | null | undefined): string {
  return crypto.createHash('sha256').update(passwordHash ?? 'no-password').digest('hex').slice(0, 16);
}

/**
 * Reset tokens for support/admin team members. Namespaced with an `admin:`
 * prefix so a venue reset token can never be replayed here (and vice versa).
 */
export function buildAdminResetToken(memberId: string, passwordHash: string | null | undefined): string {
  const exp = Date.now() + EXPIRY_MS;
  const payload = `admin:${memberId}:${exp}`;
  const sig = sign(`${payload}:${passwordFingerprint(passwordHash)}`);
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

/** The team member a reset link names, before it's checked. */
export function adminResetTokenMemberId(token: string): string | null {
  try {
    const parts = Buffer.from(token, 'base64url').toString('utf8').split(':');
    return parts.length === 4 && parts[0] === 'admin' && parts[1] ? parts[1] : null;
  } catch {
    return null;
  }
}

/** Valid only while unexpired and while the password is still the one it was issued for. */
export function verifyAdminResetToken(token: string, currentPasswordHash: string | null | undefined): { memberId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 4) return null;
    const [type, memberId, expStr, sig] = parts;
    if (type !== 'admin') return null;
    const expected = sign(`${type}:${memberId}:${expStr}:${passwordFingerprint(currentPasswordHash)}`);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
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
    { key: `admin-forgot:ip:${ip}`,       limit: perVisitorLimit(5), windowMs: 60 * 60_000 },
    { key: `admin-forgot:email:${email}`, limit: 3, windowMs: 60 * 60_000 },
  ]);
  if (!rl.allowed) {
    console.log('[admin/forgot] rate limited:', email, formatRetryAfter(rl.retryAfterMs));
    return NextResponse.json({ ok: true });
  }

  const { data: member, error } = await supabaseAdmin
    .from('support_team_members')
    .select('id, name, email, active, password_hash')
    .ilike('email', email)
    .maybeSingle();

  if (error) console.error('[admin/forgot] DB error:', error.message);

  // Only send for an existing, active team member. Master super-admin login is
  // env-based (no DB row) and cannot be reset through this flow.
  if (!member || !member.active) {
    return NextResponse.json({ ok: true });
  }

  const token = buildAdminResetToken(member.id as string, member.password_hash as string | null);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.storyvenue.com';
  const resetUrl = `${appUrl}/reset-password/admin?token=${token}`;
  const name = (member.name as string | null)?.trim() || 'there';

  try {
    await sendEmail({
      to: member.email as string,
      subject: 'Reset your StoryVenue admin password',
      html: buildSystemEmail({
        title:   'Reset your StoryVenue admin password',
        heading: 'Reset your admin password',
        bodyHtml: `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0;">Hi ${name.replace(/</g, '&lt;')}, we received a request to reset the password for your StoryVenue admin account. Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>`,
        cta:              { label: 'Reset password', url: resetUrl },
        showLinkFallback: true,
        footerHtml: `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">If you didn&apos;t request a password reset, you can safely ignore this email.</p>`,
      }),
    });
    console.log('[admin/forgot] reset email sent to:', email);
  } catch (e) {
    console.error('[admin/forgot] sendEmail failed:', e);
  }

  return NextResponse.json({ ok: true });
}
