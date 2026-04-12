import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Sign-in endpoint.
 *
 * StoryPay uses token-based auth — the "password" on the login form is the
 * venue's login_token (for owners) or the team member's invite_token (for
 * team members). Users retrieve their token via "Forgot password?" which
 * emails them their sign-in link.
 *
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
    return NextResponse.json({
      error: 'Password is required. Click "Forgot password?" if you need your sign-in link sent to your email.',
    }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();
  const token = password.trim();
  const maxAge = rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 30;

  // ── Check venue owner ──────────────────────────────────────────────────────
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, setup_completed, onboarding_status, login_token')
    .eq('email', normalized)
    .maybeSingle();

  if (venue) {
    if (venue.login_token === token) {
      // Valid owner login
      if (!venue.setup_completed && venue.onboarding_status === 'active') {
        await supabaseAdmin.from('venues').update({ setup_completed: true }).eq('id', venue.id);
      }
      const response = NextResponse.json({ redirect: '/dashboard' });
      response.cookies.set('venue_id', venue.id, {
        path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
      });
      return response;
    }
    // Email matched but token wrong — password is incorrect
    return NextResponse.json({ error: 'Incorrect password. Click "Forgot password?" to receive a sign-in link by email.' }, { status: 401 });
  }

  // ── Check team member ──────────────────────────────────────────────────────
  // Wrapped in try/catch — table may not exist in production until Setup DB is run
  try {
    const { data: member } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, venue_id, invite_token, status, email')
      .eq('email', normalized)
      .maybeSingle();

    if (member) {
      if (member.status !== 'active') {
        return NextResponse.json({ error: 'Your invitation has not been accepted yet. Check your email for the invite link.' }, { status: 401 });
      }
      if (member.invite_token === token) {
        const response = NextResponse.json({ redirect: '/dashboard' });
        response.cookies.set('venue_id', member.venue_id, {
          path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
        });
        response.cookies.set('member_id', member.id, {
          path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
        });
        return response;
      }
      // Email matched but token wrong
      return NextResponse.json({ error: 'Incorrect password. Click "Forgot password?" to receive a sign-in link by email.' }, { status: 401 });
    }
  } catch {
    // venue_team_members table missing in production — fall through to generic error
  }

  // ── No account found ───────────────────────────────────────────────────────
  return NextResponse.json({ error: 'No account found with that email address.' }, { status: 401 });
}
