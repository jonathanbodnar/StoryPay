export const dynamic = 'force-dynamic';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { issueMasterAdminToken } from '@/lib/admin-token';
import { SUPPORT_SESSION_COOKIE } from '@/lib/support/auth';
import { rateLimit, getClientIp, formatRetryAfter } from '@/lib/rate-limit';
import {
  ADMIN_OTP_PENDING_COOKIE,
  MAX_WRONG_ATTEMPTS,
  clearAttempts,
  codesMatch,
  recordWrongAttempt,
  tokenIdFromPendingCookie,
} from '@/lib/admin-otp';

interface VerifyBody { code?: string }

/**
 * Second step of the master admin sign-in: the emailed 6-digit code. It is
 * accepted only from the browser that entered the password (signed cookie set
 * by /api/admin/login, lib/admin-otp), and each code allows
 * MAX_WRONG_ATTEMPTS wrong tries before it is cancelled.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const gate = rateLimit(`admin-otp:${ip}`, 10, 10 * 60 * 1000);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${formatRetryAfter(gate.retryAfterMs)}.` },
      { status: 429 },
    );
  }

  const tokenId = tokenIdFromPendingCookie(request.cookies.get(ADMIN_OTP_PENDING_COOKIE)?.value);
  if (!tokenId) {
    return NextResponse.json({ error: 'Your sign-in expired. Enter your email and password again.' }, { status: 401 });
  }

  let body: VerifyBody = {};
  try { body = (await request.json()) as VerifyBody; } catch { /* empty */ }

  const inputCode = (body.code ?? '').trim();
  if (!inputCode || inputCode.length !== 6) {
    return NextResponse.json({ error: 'Please enter the 6-digit code.' }, { status: 400 });
  }

  // The code row this browser started, still unused and unexpired.
  const { data: token } = await supabaseAdmin
    .from('admin_otp_tokens')
    .select('id, code, expires_at, used')
    .eq('id', tokenId)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  const clearPending = (res: NextResponse) => {
    res.cookies.set(ADMIN_OTP_PENDING_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 });
    return res;
  };

  if (!token) {
    return clearPending(NextResponse.json({ error: 'This code expired. Enter your email and password again.' }, { status: 401 }));
  }

  if (!codesMatch(inputCode, String(token.code))) {
    const wrong = recordWrongAttempt(tokenId);
    if (wrong >= MAX_WRONG_ATTEMPTS) {
      await supabaseAdmin.from('admin_otp_tokens').update({ used: true }).eq('id', tokenId);
      clearAttempts(tokenId);
      return clearPending(NextResponse.json(
        { error: 'Too many wrong codes. Enter your email and password again for a new code.' },
        { status: 429 },
      ));
    }
    return NextResponse.json({ error: 'Wrong code. Try again.' }, { status: 401 });
  }

  // Mark the token as used before issuing the session (prevents replay).
  await supabaseAdmin
    .from('admin_otp_tokens')
    .update({ used: true })
    .eq('id', tokenId);
  clearAttempts(tokenId);

  const response = NextResponse.json({ success: true, identity: 'master' });
  response.cookies.set('admin_token', issueMasterAdminToken(), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  });
  // Clear any stale team member session.
  response.cookies.set(SUPPORT_SESSION_COOKIE, '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
  });
  return clearPending(response);
}
