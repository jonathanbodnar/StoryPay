import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import bcrypt from 'bcryptjs';
import { rateLimitAny, getClientIp, formatRetryAfter } from '@/lib/rate-limit';

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
      'id, name, email, setup_completed, onboarding_status, login_token, password_hash, directory_plan_id, directory_subscription_status',
    )
    .ilike('email', normalized)
    .maybeSingle();

  if (venue) {
    let valid = false;

    if (venue.password_hash) {
      // New password-based auth
      valid = await bcrypt.compare(password.trim(), venue.password_hash);
    } else {
      // Legacy: login_token as password (for accounts created before password auth)
      valid = venue.login_token === password.trim();
    }

    if (!valid) {
      return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
    }

    // Signup-plan gate: a venue owner is only "fully onboarded" once they've
    // picked a plan AND completed (or trial-activated) the subscription.
    // Legacy-plan venues bypass this entirely — they are billed externally
    // and never go through the self-serve subscription flow.
    let isLegacy = false;
    if (venue.directory_plan_id) {
      const { data: planRow } = await supabaseAdmin
        .from('directory_plans')
        .select('is_legacy, name, slug')
        .eq('id', venue.directory_plan_id)
        .maybeSingle();
      const p = planRow as { is_legacy?: boolean; name?: string | null; slug?: string | null } | null;
      // Primary check: is_legacy column. Fall back to name/slug containing "legacy"
      // in case migration 105 hasn't been run yet on this database.
      isLegacy =
        p?.is_legacy === true ||
        /legacy/i.test(p?.name ?? '') ||
        /legacy/i.test(p?.slug ?? '');
    }
    const subStatus = String(venue.directory_subscription_status ?? 'none');
    const needsPlan =
      !isLegacy && (
        !venue.directory_plan_id ||
        subStatus === 'none' ||
        subStatus === 'pending'
      );
    const redirect = needsPlan ? '/signup/plan' : '/dashboard';

    const response = NextResponse.json({ redirect });
    response.cookies.set('venue_id', venue.id, {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
    });
    return response;
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
