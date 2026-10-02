import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import {
  SUPPORT_SESSION_COOKIE,
  signSupportSession,
  verifySupportPassword,
  type SupportRole,
} from '@/lib/support/auth';
import { rateLimitAny, getClientIp, formatRetryAfter } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  // Support agents can open every venue's inbox, so cap guesses per IP and
  // per account (10 tries per 10 minutes each), like the admin login.
  const ip = getClientIp(req);
  const gate = rateLimitAny([
    { key: `support-login:ip:${ip}`, limit: 10, windowMs: 10 * 60 * 1000 },
    { key: `support-login:email:${email}`, limit: 10, windowMs: 10 * 60 * 1000 },
  ]);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${formatRetryAfter(gate.retryAfterMs)}.` },
      { status: 429 },
    );
  }

  const { data: row } = await supabaseAdmin
    .from('support_team_members')
    .select('id, email, name, role, active, password_hash')
    .eq('email', email)
    .maybeSingle();

  const member = row as {
    id: string; email: string; name: string; role: SupportRole;
    active: boolean; password_hash: string;
  } | null;

  if (!member || !member.active) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const ok = await verifySupportPassword(password, member.password_hash);
  if (!ok) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = signSupportSession({
    sub:   member.id,
    email: member.email,
    name:  member.name,
    role:  member.role,
  });

  const c = await cookies();
  c.set(SUPPORT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   60 * 60 * 24 * 7,
  });

  // Stamp last_login_at (best-effort)
  void supabaseAdmin
    .from('support_team_members')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', member.id)
    .then(({ error }) => { if (error) console.warn('[best-effort update] failed:', error.message); });

  return NextResponse.json({
    member: {
      id: member.id, email: member.email, name: member.name, role: member.role,
    },
  });
}
