import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { CONTACT_TYPES, type ContactType } from '@/lib/admin-contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COOKIE_BASE = { path: '/', sameSite: 'lax' as const, secure: true };
const CONTACT_TYPE_SET = new Set<string>(CONTACT_TYPES);

/**
 * POST /api/admin/contacts/[type]/[id]/impersonate
 *
 * Open a session as the given contact. We split the response shape by
 * contact type:
 *
 *   - venue_owner / venue_team — sets the venue cookies (act-as) on this
 *     same browser, mirroring `/api/admin/impersonate`.
 *
 *   - couple / admin_team — returns a magic-link URL the admin can open in
 *     a new tab so the original admin session stays intact.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { type, id } = await params;
  if (!CONTACT_TYPE_SET.has(type)) {
    return NextResponse.json({ error: 'Unknown contact type' }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const t = type as ContactType;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  let returnUrl = '/admin/contacts';
  try {
    const body = await req.json();
    if (typeof body?.returnUrl === 'string' && body.returnUrl.startsWith('/')) {
      returnUrl = body.returnUrl;
    }
  } catch { /* body is optional */ }

  // ── venue owner — set venue session cookies ─────────────────────────────
  if (t === 'venue_owner') {
    const { data: venue, error } = await supabaseAdmin
      .from('venues').select('id, name').eq('id', id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

    const res = NextResponse.json({
      mode: 'cookie',
      redirect: '/dashboard',
      venueName: (venue as { name: string }).name,
    });
    res.cookies.set('venue_id', id, { ...COOKIE_BASE, httpOnly: true, maxAge: 60 * 60 * 24 * 30 });
    res.cookies.set('member_id', '', { ...COOKIE_BASE, httpOnly: true, maxAge: 0 });
    res.cookies.set('admin_impersonating', '1', { ...COOKIE_BASE, httpOnly: true, maxAge: 60 * 60 * 4 });
    res.cookies.set('impersonate_return', returnUrl, { ...COOKIE_BASE, httpOnly: true, maxAge: 60 * 60 * 4 });
    return res;
  }

  if (t === 'venue_team') {
    const { data: member, error } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, venue_id, name, first_name, last_name')
      .eq('id', id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

    const venueId = (member as { venue_id?: string | null }).venue_id;
    if (!venueId) return NextResponse.json({ error: 'Member has no venue' }, { status: 400 });

    const res = NextResponse.json({
      mode: 'cookie',
      redirect: '/dashboard',
      memberName:
        (member as { name?: string | null }).name
        || [
          (member as { first_name?: string | null }).first_name,
          (member as { last_name?: string | null }).last_name,
        ].filter(Boolean).join(' '),
    });
    res.cookies.set('venue_id', venueId, { ...COOKIE_BASE, httpOnly: true, maxAge: 60 * 60 * 24 * 30 });
    res.cookies.set('member_id', id, { ...COOKIE_BASE, httpOnly: true, maxAge: 60 * 60 * 24 * 30 });
    res.cookies.set('admin_impersonating', '1', { ...COOKIE_BASE, httpOnly: true, maxAge: 60 * 60 * 4 });
    res.cookies.set('impersonate_return', returnUrl, { ...COOKIE_BASE, httpOnly: true, maxAge: 60 * 60 * 4 });
    return res;
  }

  // ── couple — magic link ─────────────────────────────────────────────────
  if (t === 'couple') {
    const { data: userResp, error: getErr } = await supabaseAdmin.auth.admin.getUserById(id);
    if (getErr || !userResp?.user?.email) {
      return NextResponse.json({ error: 'Couple not found' }, { status: 404 });
    }
    const email = userResp.user.email;
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${appUrl}/couple/dashboard` },
    });
    if (error || !data?.properties?.action_link) {
      return NextResponse.json({ error: error?.message ?? 'Could not generate link' }, { status: 500 });
    }
    return NextResponse.json({ mode: 'link', url: data.properties.action_link, email });
  }

  // ── admin team — sign them in using their own login flow ────────────────
  // We don't auto-set a support_session cookie because that would let any
  // admin pretend to be any other admin and bypass MFA. Instead, surface a
  // helpful message.
  if (t === 'admin_team') {
    return NextResponse.json(
      { error: 'Admin team members must sign in with their own credentials. Use "Reset password" to issue them a new one.' },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { error: 'This contact type cannot be impersonated.' },
    { status: 400 },
  );
}
