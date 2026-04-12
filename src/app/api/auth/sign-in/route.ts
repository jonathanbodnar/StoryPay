import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Sign-in endpoint.
 *
 * StoryPay uses magic-link auth — there are no passwords to store or hash.
 * The "password" field on the login form is the venue's login_token or a
 * team member's invite_token. Leaving it blank triggers the forgot-password
 * (send link) flow instead.
 *
 * If password is provided and matches the token → set cookie, redirect.
 * If password is blank → return error asking them to use Forgot Password.
 * If password doesn't match → generic "invalid credentials" error.
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
      error: 'Enter your password, or click "Forgot password?" to receive a sign-in link by email.',
    }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();
  const token = password.trim();
  const maxAge = rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 30;

  // Try venue owner — token is their login_token UUID
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, setup_completed, onboarding_status, login_token')
    .eq('email', normalized)
    .single();

  if (venue && venue.login_token === token) {
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

  // Try team member — token is their invite_token UUID
  const { data: member } = await supabaseAdmin
    .from('venue_team_members')
    .select('id, venue_id, invite_token, status')
    .eq('email', normalized)
    .eq('status', 'active')
    .maybeSingle();

  if (member && member.invite_token === token) {
    const response = NextResponse.json({ redirect: '/dashboard' });
    response.cookies.set('venue_id', member.venue_id, {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
    });
    response.cookies.set('member_id', member.id, {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
    });
    return response;
  }

  // No match
  return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
}
