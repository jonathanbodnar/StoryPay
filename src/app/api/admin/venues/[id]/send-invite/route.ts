/**
 * POST /api/admin/venues/[id]/send-invite
 *
 * Super-admin tool: re-issue a magic-link login email to a venue owner.
 * Rotates the venue's login_token (so any previously emailed link is
 * invalidated) and sends a fresh welcome / re-invite email.
 *
 * Body (all optional):
 *   {
 *     to?:       string;     // override recipient (defaults to venues.email)
 *     firstName?: string;    // for personalization in the email
 *     isLegacy?: boolean;    // toggles the "migrating from your previous platform" wording
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { sendEmail } from '@/lib/email';
import { buildSystemEmail } from '@/lib/email-templates';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

const LOGIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id: venueId } = await params;
  if (!venueId) return NextResponse.json({ error: 'Missing venue id' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as {
    to?: string;
    firstName?: string;
    isLegacy?: boolean;
  };

  // Pull every identity field that might be useful for the email — and
  // gracefully tolerate older schemas missing owner_first_name /
  // notification_email.
  let venue:
    | {
        id: string;
        name: string | null;
        email: string | null;
        login_token: string | null;
        owner_first_name?: string | null;
        notification_email?: string | null;
      }
    | null = null;
  {
    const { data, error: vErr } = await supabaseAdmin
      .from('venues')
      .select('id, name, email, login_token, owner_first_name, notification_email')
      .eq('id', venueId)
      .single();
    if (vErr) {
      // Retry with the column set guaranteed to exist on every schema.
      const slim = await supabaseAdmin
        .from('venues')
        .select('id, name, email, login_token')
        .eq('id', venueId)
        .single();
      if (slim.error || !slim.data) {
        return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
      }
      venue = slim.data;
    } else {
      venue = data;
    }
  }
  if (!venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  // Prefer notification_email (the routing address the owner expects) and
  // fall back to the account email. An explicit `to` always wins.
  const recipient = (
    body.to ||
    venue.notification_email ||
    venue.email ||
    ''
  ).trim();
  if (!recipient) {
    return NextResponse.json({ error: 'No email on file for this venue. Pass `to` to override.' }, { status: 400 });
  }

  // Rotate login_token so prior invites can't be reused. If the
  // login_token_expires_at column doesn't exist, fall back to just
  // rotating the token without an expiry.
  const freshToken = crypto.randomUUID();
  const expiresAt  = new Date(Date.now() + LOGIN_TOKEN_TTL_MS).toISOString();

  let usedToken: string = freshToken;
  const { error: rotErr } = await supabaseAdmin
    .from('venues')
    .update({
      login_token: freshToken,
      login_token_expires_at: expiresAt,
      login_token_last_used_at: null,
    })
    .eq('id', venueId);

  if (rotErr) {
    // Try without the expires-at column
    const { error: rot2 } = await supabaseAdmin
      .from('venues')
      .update({ login_token: freshToken })
      .eq('id', venueId);
    if (rot2) {
      console.warn('[admin send-invite] could not rotate login_token, using existing one:', rot2.message);
      if (!venue.login_token) {
        return NextResponse.json({
          error: `Could not rotate login token (${rot2.message}) and venue has no existing token. Please re-run after migrations apply.`,
        }, { status: 500 });
      }
      usedToken = venue.login_token;
    }
  }

  const appUrl   = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  const loginUrl = `${appUrl}/login/${usedToken}`;

  try {
    await sendEmail({
      to: recipient,
      subject: `Your StoryVenue login link — ${venue.name || 'your account'}`,
      html: inviteEmailHtml({
        firstName:
          (body.firstName || '').trim() ||
          (venue.owner_first_name || '').trim() ||
          'there',
        venueName: venue.name || 'your account',
        loginUrl,
        isLegacy:  Boolean(body.isLegacy),
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Email send failed: ${msg}`, loginUrl }, { status: 500 });
  }

  return NextResponse.json({ ok: true, loginUrl, sentTo: recipient });
}

function inviteEmailHtml(args: {
  firstName: string;
  venueName: string;
  loginUrl:  string;
  isLegacy:  boolean;
}): string {
  const { firstName, venueName, loginUrl, isLegacy } = args;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const intro = isLegacy
    ? `Welcome to StoryVenue! Your subaccount has been set up as part of your migration from your previous platform. Click below to log in to <strong>${esc(venueName)}</strong> — no password required.`
    : `Here&apos;s a fresh magic-link to access <strong>${esc(venueName)}</strong>. No password required.`;

  return buildSystemEmail({
    title:   `Your StoryVenue login link — ${venueName}`,
    heading: `Hi ${esc(firstName)},`,
    bodyHtml: `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0;">${intro}</p>`,
    cta:              { label: 'Log in to StoryVenue', url: loginUrl },
    showLinkFallback: true,
    footerHtml: `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">You&apos;re receiving this because the StoryVenue concierge team sent you a login link.</p>`,
  });
}
