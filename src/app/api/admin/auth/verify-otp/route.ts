export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { issueMasterAdminToken } from '@/lib/admin-token';
import { SUPPORT_SESSION_COOKIE } from '@/lib/support/auth';
import { rateLimit, getClientIp, formatRetryAfter } from '@/lib/rate-limit';

interface VerifyBody { code?: string }

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const gate = rateLimit(`admin-otp:${ip}`, 10, 10 * 60 * 1000);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${formatRetryAfter(gate.retryAfterMs)}.` },
      { status: 429 },
    );
  }

  let body: VerifyBody = {};
  try { body = (await request.json()) as VerifyBody; } catch { /* empty */ }

  const inputCode = (body.code ?? '').trim();
  if (!inputCode || inputCode.length !== 6) {
    return NextResponse.json({ error: 'Please enter the 6-digit code.' }, { status: 400 });
  }

  // Fetch the most recent unused, unexpired token.
  const { data: token } = await supabaseAdmin
    .from('admin_otp_tokens')
    .select('id, code, expires_at, used')
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!token || token.code !== inputCode) {
    return NextResponse.json(
      { error: 'Invalid or expired code. Try again.' },
      { status: 401 },
    );
  }

  // Mark the token as used before issuing the session (prevents replay).
  await supabaseAdmin
    .from('admin_otp_tokens')
    .update({ used: true })
    .eq('id', token.id as string);

  const response = NextResponse.json({ success: true, identity: 'master' });
  response.cookies.set('admin_token', issueMasterAdminToken(), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  });
  // Clear any stale team member session.
  response.cookies.set(SUPPORT_SESSION_COOKIE, '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
  });
  return response;
}
