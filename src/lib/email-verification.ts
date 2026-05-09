/**
 * Venue email verification helpers.
 *
 * Token format: random 32-byte URL-safe value. Stored on
 * `venues.email_verification_token` so we can look up by token AND
 * enforce single-use. Pair with `email_verification_token_expires_at`
 * (24h TTL by default).
 *
 * The token itself is not signed — its security comes from being a 256-bit
 * random value that we look up directly. Equality is fine because we only
 * compare against a stored hash-like opaque string.
 */

import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

/** Verification link lifetime: 24h. */
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Generate a fresh 32-byte URL-safe verification token. */
export function newVerificationToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

interface IssueAndSendArgs {
  venueId:    string;
  email:      string;
  firstName?: string | null;
  venueName?: string | null;
}

/**
 * Issue a fresh verification token for the venue and email it to them.
 * Returns the token (handy for tests + debug logs); UI flows should
 * not surface the token directly.
 */
export async function issueAndSendVerificationEmail(args: IssueAndSendArgs): Promise<string | null> {
  const token = newVerificationToken();
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();

  const { error: updateErr } = await supabaseAdmin
    .from('venues')
    .update({
      email_verification_token:            token,
      email_verification_token_expires_at: expiresAt,
      email_verification_sent_at:          new Date().toISOString(),
    })
    .eq('id', args.venueId);

  if (updateErr) {
    console.error('[email-verification] could not store token:', updateErr.message);
    return null;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.storyvenue.com';
  const verifyUrl = `${appUrl}/verify-email/${token}`;

  try {
    await sendEmail({
      to: args.email,
      subject: 'Verify your StoryVenue email address',
      html: verifyEmailHtml({
        firstName: args.firstName ?? 'there',
        venueName: args.venueName ?? 'your venue',
        verifyUrl,
      }),
    });
  } catch (e) {
    console.error('[email-verification] sendEmail failed:', e);
  }

  return token;
}

/**
 * Validate a verification token. Returns the venue id on success and
 * marks the venue as verified (clearing the token so it can't be reused).
 *
 * Returns null on:
 *  - unknown token
 *  - already-used token (cleared after first redemption)
 *  - expired token
 */
export async function consumeVerificationToken(token: string): Promise<{ venueId: string } | null> {
  if (!token) return null;

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, email, email_verification_token_expires_at, email_verified_at')
    .eq('email_verification_token', token)
    .maybeSingle();

  if (!venue) return null;

  const expRaw = (venue as { email_verification_token_expires_at?: string | null })
    .email_verification_token_expires_at;
  if (expRaw && new Date(expRaw).getTime() < Date.now()) {
    return null;
  }

  const nowIso = new Date().toISOString();
  // Mark verified + clear the token in a single round-trip.
  // Idempotent: re-clicking a freshly-used link returns null cleanly
  // (because the token field is null on the next lookup).
  const { error: clearErr } = await supabaseAdmin
    .from('venues')
    .update({
      email_verified_at:                   venue.email_verified_at ?? nowIso,
      email_verification_token:            null,
      email_verification_token_expires_at: null,
    })
    .eq('id', venue.id);

  if (clearErr) {
    console.error('[email-verification] could not clear token:', clearErr.message);
    return null;
  }

  return { venueId: venue.id as string };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function verifyEmailHtml({
  firstName, venueName, verifyUrl,
}: {
  firstName: string;
  venueName: string;
  verifyUrl: string;
}): string {
  return `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background-color:#1b1b1b;padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:22px;margin:0;font-weight:300">StoryVenue</h1>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#111827;font-size:20px;font-weight:700;margin:0 0 16px">
      Confirm your email, ${escapeHtml(firstName)}
    </h2>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px">
      Thanks for signing up <strong>${escapeHtml(venueName)}</strong> on StoryVenue.
      Please confirm your email address to activate payment processing.
      This link expires in <strong>24 hours</strong>.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${verifyUrl}"
        style="background-color:#1b1b1b;border-radius:10px;color:#ffffff;display:inline-block;font-family:'Open Sans',Arial,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;width:240px;">
        <span style="color:#ffffff;text-decoration:none;">Verify Email</span>
      </a>
    </div>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 8px">
      Or copy and paste this link into your browser:
    </p>
    <p style="color:#1b1b1b;font-size:12px;word-break:break-all;margin:0 0 24px">
      ${verifyUrl}
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
      If you didn&apos;t create a StoryVenue account, you can safely ignore this email.
    </p>
  </div>
</div>`;
}
