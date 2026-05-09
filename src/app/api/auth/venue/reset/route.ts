import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import bcrypt from 'bcryptjs';
import { verifyResetToken } from '../forgot/route';
import { rateLimit, getClientIp, formatRetryAfter } from '@/lib/rate-limit';
import { checkPassword } from '@/lib/password-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/auth/venue/reset
 *
 * Body: { token: string; password: string; rememberMe?: boolean }
 *
 * Validates the signed reset token, bcrypt-hashes the new password, and
 * updates venues.password_hash. Sets the venue_id cookie so the user is
 * logged in immediately after the reset.
 */
export async function POST(req: NextRequest) {
  // Rate limit reset-token submissions per IP (10/hr).
  const ip = getClientIp(req);
  const rl = rateLimit(`reset:ip:${ip}`, 10, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many reset attempts. Try again in ${formatRetryAfter(rl.retryAfterMs)}.` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let token = '', password = '', rememberMe = false;
  try {
    const body = await req.json();
    token = (body?.token ?? '').trim();
    password = (body?.password ?? '').trim();
    rememberMe = Boolean(body?.rememberMe);
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!token) return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
  const pwCheck = checkPassword(password);
  if (!pwCheck.valid) {
    return NextResponse.json({ error: pwCheck.message }, { status: 400 });
  }

  const parsed = verifyResetToken(token);
  if (!parsed) {
    return NextResponse.json(
      { error: 'This reset link has expired or is invalid. Please request a new one.' },
      { status: 400 },
    );
  }

  const { data: venue, error: venueErr } = await supabaseAdmin
    .from('venues')
    .select('id, name')
    .eq('id', parsed.venueId)
    .maybeSingle();

  if (venueErr || !venue) {
    return NextResponse.json({ error: 'Venue not found.' }, { status: 404 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { error: updateErr } = await supabaseAdmin
    .from('venues')
    .update({ password_hash: passwordHash })
    .eq('id', venue.id);

  if (updateErr) {
    console.error('[venue/reset] update failed:', updateErr.message);
    return NextResponse.json({ error: 'Could not update password. Please try again.' }, { status: 500 });
  }

  console.log('[venue/reset] password updated for venue:', venue.id);

  const maxAge = rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 30;
  const response = NextResponse.json({ ok: true, redirect: '/dashboard' });
  response.cookies.set('venue_id', venue.id as string, {
    path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
  });
  return response;
}
