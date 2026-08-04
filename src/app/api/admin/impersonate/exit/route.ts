import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { clearSignedCookie } from '@/lib/venue-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COOKIE_BASE = {
  path: '/',
  sameSite: 'lax' as const,
  secure: true,
};

/** Clear venue impersonation cookies; keep admin_token. Returns to stored returnUrl. */
export async function POST() {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cookieStore = await cookies();
  const returnUrl = cookieStore.get('impersonate_return')?.value || '/admin/support';

  const res = NextResponse.json({ ok: true, redirect: returnUrl });

  clearSignedCookie(res, 'venue_id', { ...COOKIE_BASE, httpOnly: true });
  clearSignedCookie(res, 'member_id', { ...COOKIE_BASE, httpOnly: true });
  res.cookies.set('admin_impersonating', '', { ...COOKIE_BASE, httpOnly: true, maxAge: 0 });
  res.cookies.set('impersonate_return', '', { ...COOKIE_BASE, httpOnly: true, maxAge: 0 });

  return res;
}
