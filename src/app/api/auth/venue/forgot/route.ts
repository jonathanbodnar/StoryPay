import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
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
      html: `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:22px;margin:0;font-weight:300">StoryVenue</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">Reset your password</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px">
      We received a request to reset the password for the StoryVenue account
      for <strong>${venueName}</strong>. Click the button below — this link
      expires in <strong>1 hour</strong>.
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
    console.log('[venue/forgot] reset email sent to:', email);
  } catch (e) {
    console.error('[venue/forgot] sendEmail failed:', e);
  }

  return NextResponse.json({ ok: true });
}
