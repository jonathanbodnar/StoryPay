import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import bcrypt from 'bcryptjs';
import { rateLimitAny, getClientIp, formatRetryAfter } from '@/lib/rate-limit';
import { signPendingToken, TWO_FA_PENDING_COOKIE } from '@/lib/twofa-pending';
import { buildVenueAuthSuccessResponse } from '@/lib/auth-success';

/**
 * Sign-in endpoint — email + password auth for venue owners and team members.
 *
 * Venue owners authenticate with the password set during signup (bcrypt).
 * Team members authenticate with their invite_token (unchanged).
 * "Remember me" extends the cookie from 30 days to 365 days.
 */
export async function POST(request: NextRequest) {
  const { email, password, rememberMe } = await request.json() as {
    email?: string;
    password?: string;
    rememberMe?: boolean;
  };

  if (!email?.trim()) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }
  if (!password?.trim()) {
    return NextResponse.json({ error: 'Password is required.' }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();

  // Rate limit: per-IP (10/min) AND per-email (5/min). Brute-force protection.
  const ip = getClientIp(request);
  const rl = rateLimitAny([
    { key: `signin:ip:${ip}`,        limit: 10, windowMs: 60_000 },
    { key: `signin:email:${normalized}`, limit: 5,  windowMs: 60_000 },
  ]);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many sign-in attempts. Try again in ${formatRetryAfter(rl.retryAfterMs)}.` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const maxAge = rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 30;

  // ── Check venue owner ──────────────────────────────────────────────────────
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, email, setup_completed, onboarding_status, login_token, password_hash, directory_plan_id, directory_subscription_status, totp_enabled_at',
    )
    .ilike('email', normalized)
    .maybeSingle();

  if (venue) {
    let valid = false;

    if (venue.password_hash) {
      // Password-based auth (the only supported path).
      valid = await bcrypt.compare(password.trim(), venue.password_hash);
    } else {
      // Legacy accounts that never set a password must request a magic
      // link via /forgot-password. Accepting the raw login_token as a
      // password value would defeat magic-link rotation (H14).
      console.warn('[sign-in] legacy venue without password_hash:', venue.id);
      return NextResponse.json(
        { error: 'Please reset your password to continue.' },
        { status: 401 },
      );
    }

    if (!valid) {
      return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
    }

    // ── 2FA gate ─────────────────────────────────────────────────────────────
    // Password is correct. If 2FA is enabled, hold the session in a short-lived
    // signed cookie and let the client redirect to the code-prompt screen.
    // We do NOT set venue_id here — that only happens after the TOTP verifies.
    if (venue.totp_enabled_at) {
      try {
        const pending = signPendingToken({
          venueId:    venue.id,
          issuedAt:   Date.now(),
          rememberMe: Boolean(rememberMe),
        });
        const response = NextResponse.json({ requires2FA: true });
        response.cookies.set(TWO_FA_PENDING_COOKIE, pending, {
          path: '/', httpOnly: true, secure: true, sameSite: 'lax',
          maxAge: 5 * 60,
        });
        return response;
      } catch (err) {
        console.error('[sign-in] 2FA pending-token failed:', err);
        return NextResponse.json(
          { error: 'Sign-in temporarily unavailable. Please try again.' },
          { status: 500 },
        );
      }
    }

    return buildVenueAuthSuccessResponse({
      venueId:    venue.id,
      rememberMe: Boolean(rememberMe),
      prefetched: {
        directory_plan_id:             (venue.directory_plan_id as string | null) ?? null,
        directory_subscription_status: (venue.directory_subscription_status as string | null) ?? null,
      },
    });
  }

  // ── Check team member ──────────────────────────────────────────────────────
  try {
    const { data: member } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, venue_id, invite_token, status, email')
      .ilike('email', normalized)
      .maybeSingle();

    if (member) {
      if (member.status !== 'active') {
        return NextResponse.json(
          { error: 'Your invitation has not been accepted yet. Check your email for the invite link.' },
          { status: 401 }
        );
      }
      if (member.invite_token === password.trim()) {
        const response = NextResponse.json({ redirect: '/dashboard' });
        response.cookies.set('venue_id', member.venue_id, {
          path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
        });
        response.cookies.set('member_id', member.id, {
          path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
        });
        return response;
      }
      return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
    }
  } catch {
    // venue_team_members table missing — fall through
  }

  // Same generic error as bad-password to prevent user enumeration.
  // Without this, an attacker could probe valid venue emails by reading the response.
  return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
}
