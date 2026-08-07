import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/couples/[id]
 *
 * Returns the full couple_profiles row + auth user info (email,
 * email_confirmed_at, last_sign_in_at) so the admin edit modal can
 * hydrate every field that exists on the couple's own profile page.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { data: userResp, error: getErr } = await supabaseAdmin.auth.admin.getUserById(id);
  if (getErr || !userResp?.user) {
    return NextResponse.json({ error: 'Couple not found' }, { status: 404 });
  }

  // Try to fetch the full row including first_name/last_name. Fall back
  // to the legacy schema if those columns don't exist yet.
  type AnyProfile = Record<string, unknown> & { id: string };
  let profile: AnyProfile | null = null;
  {
    const initial = await supabaseAdmin
      .from('couple_profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    profile = (initial.data as AnyProfile | null) ?? null;
    if (initial.error) {
      console.warn('[admin/couples GET] couple_profiles select error:', initial.error.message);
    }
  }

  return NextResponse.json({
    couple: {
      id,
      email: userResp.user.email ?? null,
      email_confirmed_at: userResp.user.email_confirmed_at ?? null,
      last_sign_in_at: userResp.user.last_sign_in_at ?? null,
      created_at: profile?.created_at ?? userResp.user.created_at ?? null,
      first_name: (profile?.first_name as string | null) ?? null,
      last_name: (profile?.last_name as string | null) ?? null,
      display_name: (profile?.display_name as string | null) ?? null,
      phone: (profile?.phone as string | null) ?? null,
      address_line1: (profile?.address_line1 as string | null) ?? null,
      address_line2: (profile?.address_line2 as string | null) ?? null,
      city: (profile?.city as string | null) ?? null,
      state: (profile?.state as string | null) ?? null,
      postal_code: (profile?.postal_code as string | null) ?? null,
      country: (profile?.country as string | null) ?? 'US',
      wedding_date: (profile?.wedding_date as string | null) ?? null,
      instagram_url: (profile?.instagram_url as string | null) ?? null,
      facebook_url: (profile?.facebook_url as string | null) ?? null,
      tiktok_url: (profile?.tiktok_url as string | null) ?? null,
      pinterest_url: (profile?.pinterest_url as string | null) ?? null,
    },
  });
}

/**
 * PATCH /api/admin/couples/[id]
 *
 * Accepts every field the couple themselves can manage on /couple/profile,
 * plus the auth-only fields (email, password). All inputs optional; only
 * the fields included in the body are updated.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // ── Update auth.users (email/password) ───────────────────────────────────
  const authUpdates: { email?: string; password?: string; email_confirm?: boolean } = {};
  if (typeof body.email === 'string') {
    const e = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }
    authUpdates.email = e;
    authUpdates.email_confirm = true;
  }
  if (typeof body.password === 'string') {
    if (body.password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    authUpdates.password = body.password;
  }

  if (Object.keys(authUpdates).length > 0) {
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(id, authUpdates);
    if (authErr) {
      const m = authErr.message ?? '';
      if (/registered|exists|duplicate/i.test(m)) {
        return NextResponse.json({ error: 'That email is already in use.' }, { status: 409 });
      }
      console.error('[admin/couples PATCH] auth update error:', authErr);
      return NextResponse.json({ error: m || 'Auth update failed' }, { status: 500 });
    }
  }

  // ── Build couple_profiles patch ────────────────────────────────────────
  // We accept any subset of keys; only included fields are written.
  const TEXT_FIELDS = [
    'first_name', 'last_name', 'display_name', 'phone',
    'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country',
    'instagram_url', 'facebook_url', 'tiktok_url', 'pinterest_url',
  ] as const;

  const profileUpdates: Record<string, unknown> = {};
  for (const field of TEXT_FIELDS) {
    if (field in body) {
      const v = body[field];
      profileUpdates[field] = typeof v === 'string' && v.trim() ? v.trim() : null;
    }
  }
  if ('wedding_date' in body) {
    const v = body.wedding_date;
    profileUpdates.wedding_date =
      typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }

  // Keep display_name in sync with first/last when only names provided
  if (
    ('first_name' in body || 'last_name' in body) &&
    !('display_name' in body)
  ) {
    const f = (body.first_name as string | undefined)?.toString().trim() ?? '';
    const l = (body.last_name as string | undefined)?.toString().trim() ?? '';
    const combined = `${f} ${l}`.trim();
    if (combined) profileUpdates.display_name = combined;
  }

  if (Object.keys(profileUpdates).length > 0) {
    profileUpdates.updated_at = new Date().toISOString();

    // Make sure a profile row exists before update
    const { data: existing } = await supabaseAdmin
      .from('couple_profiles')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (!existing) {
      await supabaseAdmin.from('couple_profiles').insert({ id });
    }

    let { error: profErr } = await supabaseAdmin
      .from('couple_profiles')
      .update(profileUpdates)
      .eq('id', id);

    // If first_name/last_name columns don't exist yet (migration 077 not
    // run), retry without them so the rest of the update still applies.
    if (profErr && /first_name|last_name/i.test(profErr.message)) {
      const fallback = { ...profileUpdates };
      delete (fallback as Record<string, unknown>).first_name;
      delete (fallback as Record<string, unknown>).last_name;
      const retry = await supabaseAdmin
        .from('couple_profiles')
        .update(fallback)
        .eq('id', id);
      profErr = retry.error;
    }

    if (profErr) {
      console.error('[admin/couples PATCH] profile update error:', profErr);
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/couples/[id]
 *
 * Removes the couple_profiles row, auth.users record, and frees the email
 * for re-registration. Storage / saved venues cascade via FK constraints.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Best-effort: delete the public profile first (FK from auth.users)
  try {
    await supabaseAdmin.from('couple_profiles').delete().eq('id', id);
  } catch (e) {
    console.warn('[admin/couples DELETE] couple_profiles delete failed (non-fatal):', e);
  }

  // Best-effort: delete saved-venue rows if not cascaded
  try {
    await supabaseAdmin.from('couple_saved_venues').delete().eq('couple_id', id);
  } catch {
    // ignore
  }

  // Delete the auth user (this is what frees the email for re-registration)
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) {
    console.error('[admin/couples DELETE] auth user delete error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
