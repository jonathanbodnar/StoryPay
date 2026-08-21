import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildSystemEmail } from '@/lib/email-templates';
import { rateLimitAny, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Couple "forgot password" handler.
 *
 * Flow:
 *  1. Generate a recovery link via `auth.admin.generateLink`. This
 *     implicitly verifies the user exists — Supabase returns an error
 *     otherwise.
 *  2. Email the link via Resend (we deliver our own email so we don't
 *     depend on Supabase's SMTP / redirect-URL allowlist).
 *
 * To prevent account enumeration, we always return `{ ok: true }`. Server
 * logs contain the diagnostic detail for debugging delivery problems.
 */
export async function POST(req: NextRequest) {
  let payload: { email?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = payload.email?.trim()?.toLowerCase() ?? '';
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }

  // Rate limit to prevent email-bombing: per-IP (5/hr) and per-email (3/hr).
  // Always return ok:true so attackers can't enumerate accounts.
  const ip = getClientIp(req);
  const rl = rateLimitAny([
    { key: `couple-forgot:ip:${ip}`,       limit: 5, windowMs: 60 * 60_000 },
    { key: `couple-forgot:email:${email}`, limit: 3, windowMs: 60 * 60_000 },
  ]);
  if (!rl.allowed) {
    console.log('[couple/forgot] rate limited:', email);
    return NextResponse.json({ ok: true });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.storyvenue.com';
  const redirectTo = `${appUrl}/couple/reset-password`;

  console.log('[couple/forgot] request for', email);

  // ── Generate recovery link ───────────────────────────────────────────────
  let resetUrl: string | null = null;
  try {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo },
    });
    if (error) {
      console.error('[couple/forgot] generateLink error:', error.message);
    } else if (!data?.properties?.action_link) {
      console.error('[couple/forgot] generateLink returned no action_link');
    } else {
      resetUrl = data.properties.action_link;
    }
  } catch (e) {
    console.error('[couple/forgot] generateLink exception:', e);
  }

  if (!resetUrl) {
    // Either user doesn't exist or Supabase had a problem — silent ok to
    // avoid revealing account existence
    return NextResponse.json({ ok: true });
  }

  // ── Send our own email via Resend ────────────────────────────────────────
  const result = await sendEmail({
    to: email,
    subject: 'Reset your StoryVenue password',
    html: resetEmailHtml(resetUrl),
  });

  if (!result.success) {
    console.error('[couple/forgot] sendEmail failed for', email, result.error);
  } else {
    console.log('[couple/forgot] email sent to', email);
  }

  return NextResponse.json({ ok: true });
}

function resetEmailHtml(resetUrl: string) {
  return buildSystemEmail({
    title:   'Reset your StoryVenue password',
    heading: 'Reset your password',
    bodyHtml: `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0;">Click the button below to set a new password for your StoryVenue couple account. This link expires in 1 hour.</p>`,
    cta:              { label: 'Reset password', url: resetUrl },
    showLinkFallback: true,
    footerHtml: `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">If you didn&apos;t request a password reset, you can safely ignore this email.</p>`,
  });
}
