import { NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COOKIE_BASE = {
  path: '/',
  sameSite: 'lax' as const,
  secure: true,
};

/** Clear venue impersonation cookies; keep admin_token. */
export async function POST() {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, redirect: '/admin' });

  res.cookies.set('venue_id', '', { ...COOKIE_BASE, httpOnly: true, maxAge: 0 });
  res.cookies.set('member_id', '', { ...COOKIE_BASE, httpOnly: true, maxAge: 0 });
  res.cookies.set('admin_impersonating', '', { ...COOKIE_BASE, httpOnly: true, maxAge: 0 });

  return res;
}
