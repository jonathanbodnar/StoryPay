import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildSystemEmail } from '@/lib/email-templates';
import { rateLimitAny, getClientIp, formatRetryAfter } from '@/lib/rate-limit';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function sign(payload: string): string {
  const secret = process.env.ADMIN_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Critical: do not silently fall back to a literal string. A predictable
    // signing secret would let anyone forge reset tokens for any venue.
    throw new Error(
      'ADMIN_SECRET (or NEXTAUTH_SECRET) is not configured. Password reset tokens cannot be signed.',
    );
  }
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function buildResetToken(venueId: string): string {
  const exp = Date.now() + EXPIRY_MS;
  const payload = `${venueId}:${exp}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function verifyResetToken(token: string): { venueId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    const [venueId, expStr, sig] = parts;
    const payload = `${venueId}:${expStr}`;
    if (sign(payload) !== sig) return null;
    if (Date.now() > Number(expStr)) return null;
    return { venueId };
  } catch {
    return null;
  }
}

/**
 * POST /api/auth/venue/forgot
 *
 * Accepts { email } and (if a matching venue is found) sends a
 * password-reset email. Always returns 200 to prevent enumeration.
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

  // Rate limit to prevent email-bombing a venue. Per-IP (5/hr) AND
  // per-email (3/hr). Always return ok:true so attackers can't enumerate.
  const ip = getClientIp(req);
  const rl = rateLimitAny([
    { key: `forgot:ip:${ip}`,       limit: 5, windowMs: 60 * 60_000 },
    { key: `forgot:email:${email}`, limit: 3, windowMs: 60 * 60_000 },
  ]);
  if (!rl.allowed) {
    console.log('[venue/forgot] rate limited:', email, formatRetryAfter(rl.retryAfterMs));
    return NextResponse.json({ ok: true });
  }

  console.log('[venue/forgot] request for:', email);

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, email')
    .ilike('email', email)
    .maybeSingle();

  if (error) console.error('[venue/forgot] DB error:', error.message);

  if (!venue) {
    console.log('[venue/forgot] no venue found for:', email);
    return NextResponse.json({ ok: true });
  }

  const token = buildResetToken(venue.id);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.storyvenue.com';
  const resetUrl = `${appUrl}/reset-password/venue?token=${token}`;

  const venueName = (venue.name as string | null) ?? 'your venue';

  try {
    await sendEmail({
      to: email,
      subject: 'Reset your StoryVenue password',
      html: buildSystemEmail({
        title:   'Reset your StoryVenue password',
        heading: 'Reset your password',
        bodyHtml: `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0;">We received a request to reset the password for the StoryVenue account for <strong>${venueName.replace(/</g, '&lt;')}</strong>. Click the button below. This link expires in <strong>1 hour</strong>.</p>`,
        cta:              { label: 'Reset password', url: resetUrl },
        showLinkFallback: true,
        footerHtml: `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">If you didn&apos;t request a password reset, you can safely ignore this email.</p>`,
      }),
    });
    console.log('[venue/forgot] reset email sent to:', email);
  } catch (e) {
    console.error('[venue/forgot] sendEmail failed:', e);
  }

  return NextResponse.json({ ok: true });
}
