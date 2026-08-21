import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildSystemEmail } from '@/lib/email-templates';
import { rateLimitAny, getClientIp } from '@/lib/rate-limit';

/** Magic-link token lifetime: 24 hours from issue. */
const LOGIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Generate a fresh URL-safe magic-link token. */
function newLoginToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export async function POST(request: NextRequest) {
  const { email } = await request.json();

  if (!email?.trim() || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();

  // Rate limit per-IP and per-email to prevent magic-link email-bombing.
  const ip = getClientIp(request);
  const rl = rateLimitAny([
    { key: `request-login:ip:${ip}`,           limit: 5, windowMs: 60 * 60_000 },
    { key: `request-login:email:${normalized}`, limit: 3, windowMs: 60 * 60_000 },
  ]);
  if (!rl.allowed) {
    console.log('[request-login] rate limited:', normalized);
    return NextResponse.json({ ok: true });
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

  // Check venue owner accounts (ilike = case-insensitive so Jason@... matches jason@...)
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, login_token, email')
    .ilike('email', normalized)
    .maybeSingle();

  // Check team member accounts (table may not exist in production — handle gracefully)
  let member: { id: string; invite_token: string; first_name: string; venue_id: string } | null = null;
  try {
    const memberRes = await supabaseAdmin
      .from('venue_team_members')
      .select('id, invite_token, first_name, venue_id')
      .ilike('email', normalized)
      .eq('status', 'active')
      .maybeSingle();
    member = memberRes.data ?? null;
  } catch { /* table may not exist in production */ }

  if (!venue && !member) {
    // Always return success — don't reveal whether the email exists or not (security)
    return NextResponse.json({ ok: true });
  }

  if (venue) {
    // Rotate the magic-link token on every request so previously issued
    // emails (or leaked links) become invalid. Stamp a 24h expiry — see
    // /api/auth/venue/[token] for redemption + further rotation on use.
    const freshToken = newLoginToken();
    const expiresAt  = new Date(Date.now() + LOGIN_TOKEN_TTL_MS).toISOString();
    const { error: rotErr } = await supabaseAdmin
      .from('venues')
      .update({
        login_token: freshToken,
        login_token_expires_at: expiresAt,
        login_token_last_used_at: null,
      })
      .eq('id', venue.id);
    // If the column hasn't been migrated yet, fall back to the existing
    // (legacy) token rather than blocking login entirely.
    const tokenForUrl = rotErr ? venue.login_token : freshToken;
    if (rotErr) {
      console.warn('[request-login] login_token_expires_at column missing — using legacy token. Run migration 122.');
    }
    const loginUrl = `${appUrl}/login/${tokenForUrl}`;
    await sendEmail({
      to: normalized,
      subject: `Your StoryVenue login link for ${venue.name || 'your account'}`,
      html: loginEmailHtml({ name: venue.name || 'your account', loginUrl, isTeamMember: false }),
    });
  }

  if (member?.invite_token) {
    // Re-use the invite token as the login link for active team members
    const loginUrl = `${appUrl}/api/invite/${member.invite_token}`;
    const { data: venueData } = await supabaseAdmin
      .from('venues')
      .select('name, brand_color, brand_logo_url')
      .eq('id', member.venue_id)
      .single();

    await sendEmail({
      to: normalized,
      subject: `Your StoryVenue login link`,
      html: loginEmailHtml({
        name: member.first_name || 'there',
        loginUrl,
        isTeamMember: true,
        venueName: venueData?.name,
        brandColor: venueData?.brand_color,
        logoUrl: venueData?.brand_logo_url,
      }),
    });
  }

  return NextResponse.json({ ok: true });
}

function loginEmailHtml({
  name, loginUrl, isTeamMember = false,
  venueName, brandColor = '#1b1b1b', logoUrl,
}: {
  name: string; loginUrl: string; isTeamMember?: boolean;
  venueName?: string; brandColor?: string; logoUrl?: string;
}) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const acctLabel = isTeamMember && venueName ? ` (${esc(venueName)})` : '';
  return buildSystemEmail({
    logoUrl:     logoUrl || undefined,
    brandName:   isTeamMember ? (venueName || undefined) : undefined,
    logoAlt:     venueName || 'StoryVenue',
    accentColor: brandColor,
    title:       'Your StoryVenue login link',
    heading:     'Your login link',
    bodyHtml: `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px;">Hi ${esc(name)},</p>
      <p style="color:#374151;font-size:15px;line-height:1.7;margin:0;">Click the button below to log in to your StoryVenue account${acctLabel}. This link is valid for your current session.</p>`,
    cta:              { label: 'Log in to StoryVenue', url: loginUrl },
    showLinkFallback: true,
    footerHtml: `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">If you didn&apos;t request this link, you can safely ignore this email. Your account is still secure.</p>`,
  });
}
