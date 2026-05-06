import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COOKIE_BASE = {
  path: '/',
  sameSite: 'lax' as const,
  secure: true,
};

/**
 * POST /api/admin/impersonate — set venue session cookies while keeping admin_token.
 * Body: { venueId: string }
 */
export async function POST(request: NextRequest) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { venueId?: string; returnUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const venueId   = typeof body.venueId   === 'string' ? body.venueId.trim()   : '';
  const returnUrl = typeof body.returnUrl === 'string' ? body.returnUrl.trim()  : '/admin/support';
  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .select('id, name')
    .eq('id', venueId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const res = NextResponse.json({ ok: true, redirect: '/dashboard', venueName: (venue as { name: string }).name });

  res.cookies.set('venue_id', venueId, {
    ...COOKIE_BASE,
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
  });

  res.cookies.set('member_id', '', {
    ...COOKIE_BASE,
    httpOnly: true,
    maxAge: 0,
  });

  res.cookies.set('admin_impersonating', '1', {
    ...COOKIE_BASE,
    httpOnly: true,
    maxAge: 60 * 60 * 4,
  });

  // Store where to return after exiting impersonation
  res.cookies.set('impersonate_return', returnUrl, {
    ...COOKIE_BASE,
    httpOnly: true,
    maxAge: 60 * 60 * 4,
  });

  return res;
}
