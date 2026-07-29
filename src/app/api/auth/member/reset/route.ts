import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import bcrypt from 'bcryptjs';
import { rateLimit, getClientIp, formatRetryAfter } from '@/lib/rate-limit';
import { checkPassword } from '@/lib/password-policy';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/auth/member/reset
 *
 * Body: { token: string; password: string }
 *
 * Validates the invite_token (used as a one-time password-reset token),
 * bcrypt-hashes the new password, rotates the invite_token so the link
 * can only be used once, and logs the member in by setting cookies.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`member-reset:ip:${ip}`, 10, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${formatRetryAfter(rl.retryAfterMs)}.` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let token = '', password = '';
  try {
    const body = await req.json();
    token = (body?.token ?? '').trim();
    password = (body?.password ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!token) return NextResponse.json({ error: 'Missing token.' }, { status: 400 });

  const pwCheck = checkPassword(password);
  if (!pwCheck.valid) {
    return NextResponse.json({ error: pwCheck.message }, { status: 400 });
  }

  const { data: member, error: memberErr } = await supabaseAdmin
    .from('venue_team_members')
    .select('id, venue_id, status, email')
    .eq('invite_token', token)
    .maybeSingle();

  if (memberErr || !member) {
    return NextResponse.json(
      { error: 'This link has expired or is invalid. Please ask your account manager to resend.' },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  // Rotate the invite_token so this reset link cannot be replayed.
  const freshToken = crypto.randomUUID();

  const { error: updateErr } = await supabaseAdmin
    .from('venue_team_members')
    .update({
      password_hash: passwordHash,
      invite_token: freshToken,
      // Activate the member if they were still in invited state.
      status: 'active',
    })
    .eq('id', member.id);

  if (updateErr) {
    console.error('[member/reset] update failed:', updateErr.message);
    return NextResponse.json({ error: 'Could not update password. Please try again.' }, { status: 500 });
  }

  const maxAge = 60 * 60 * 24 * 30;
  const response = NextResponse.json({ ok: true, redirect: '/dashboard' });
  response.cookies.set('venue_id', member.venue_id as string, {
    path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
  });
  response.cookies.set('member_id', member.id as string, {
    path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
  });
  return response;
}
