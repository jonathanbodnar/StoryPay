import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * PATCH /api/admin/couples/[id]
 *
 * Body fields (any combination):
 *  - email: update auth.users email
 *  - password: set a new password (min 8 chars)
 *  - display_name: update couple_profiles.display_name
 *  - phone: update couple_profiles.phone
 *  - wedding_date: update couple_profiles.wedding_date (YYYY-MM-DD or null)
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

  let body: {
    email?: string;
    password?: string;
    first_name?: string | null;
    last_name?: string | null;
    display_name?: string | null;
    phone?: string | null;
    wedding_date?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // ── Update auth.users (email/password) ───────────────────────────────────
  const authUpdates: { email?: string; password?: string } = {};
  if (typeof body.email === 'string') {
    const e = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }
    authUpdates.email = e;
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
      console.error('[admin/couples PATCH] auth update error:', authErr);
      return NextResponse.json({ error: authErr.message }, { status: 500 });
    }
  }

  // ── Update couple_profiles ────────────────────────────────────────────
  const profileUpdates: Record<string, unknown> = {};
  if ('first_name' in body) profileUpdates.first_name = body.first_name?.toString().trim() || null;
  if ('last_name' in body) profileUpdates.last_name = body.last_name?.toString().trim() || null;
  if ('display_name' in body) profileUpdates.display_name = body.display_name?.toString().trim() || null;
  if ('phone' in body) profileUpdates.phone = body.phone?.toString().trim() || null;
  if ('wedding_date' in body) {
    const v = body.wedding_date;
    profileUpdates.wedding_date = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }

  // Keep display_name in sync with first/last when admin only sends names
  if (
    ('first_name' in body || 'last_name' in body) &&
    !('display_name' in body)
  ) {
    const f = body.first_name?.toString().trim() ?? '';
    const l = body.last_name?.toString().trim() ?? '';
    const combined = `${f} ${l}`.trim();
    if (combined) profileUpdates.display_name = combined;
  }

  if (Object.keys(profileUpdates).length > 0) {
    profileUpdates.updated_at = new Date().toISOString();
    let { error: profErr } = await supabaseAdmin
      .from('couple_profiles')
      .update(profileUpdates)
      .eq('id', id);

    // If first_name/last_name columns don't exist yet, retry without them
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
