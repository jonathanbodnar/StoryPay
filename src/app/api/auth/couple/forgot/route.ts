import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

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
    html: resetEmailHtml(resetUrl, appUrl),
  });

  if (!result.success) {
    console.error('[couple/forgot] sendEmail failed for', email, result.error);
  } else {
    console.log('[couple/forgot] email sent to', email);
  }

  return NextResponse.json({ ok: true });
}

function resetEmailHtml(resetUrl: string, appUrl: string) {
  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:22px;margin:0;font-weight:300">StoryVenue</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">Reset your password</h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px">
      Click the button below to set a new password for your StoryVenue couple account.
      This link expires in 1 hour.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${resetUrl}"
        style="background-color:#1b1b1b;border-radius:10px;color:#ffffff;display:inline-block;font-family:'Open Sans',Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        <span style="color:#ffffff;text-decoration:none;">Reset Password</span>
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0">
      If the button doesn&apos;t work, copy this link:<br>
      <a href="${resetUrl}" style="color:#1b1b1b;text-decoration:underline;word-break:break-all;">${resetUrl}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
      If you didn&apos;t request a password reset, you can safely ignore this email.
    </p>
  </div>
</div>
<p style="color:#9ca3af;font-size:11px;text-align:center;margin:16px 0 0">
  <a href="${appUrl}" style="color:#9ca3af;text-decoration:underline;">StoryVenue</a>
</p>`;
}
