import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie, verifyMasterAdminOnly } from '@/lib/admin-auth';
import { hashSupportPassword } from '@/lib/support/auth';
import { CONTACT_TYPES, type ContactType } from '@/lib/admin-contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONTACT_TYPE_SET = new Set<string>(CONTACT_TYPES);

async function readType(params: Promise<{ type: string; id: string }>): Promise<
  { ok: true; type: ContactType; id: string } | { ok: false; res: NextResponse }
> {
  const { type, id } = await params;
  if (!CONTACT_TYPE_SET.has(type)) {
    return { ok: false, res: NextResponse.json({ error: 'Unknown contact type' }, { status: 400 }) };
  }
  if (!id) {
    return { ok: false, res: NextResponse.json({ error: 'Missing id' }, { status: 400 }) };
  }
  return { ok: true, type: type as ContactType, id };
}

function safeText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

/** Strip undefined keys so we never write JSON `null` over an unset field. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/**
 * GET — fetch the full profile of one contact (all the fields the admin
 * Contacts edit drawer renders). The shape is per-type because each kind of
 * contact has a different schema.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const parsed = await readType(params);
  if (!parsed.ok) return parsed.res;
  const { type, id } = parsed;

  if (type === 'venue_owner') {
    const { data, error } = await supabaseAdmin
      .from('venues')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Strip secrets
    const safe = { ...data } as Record<string, unknown>;
    delete safe.lunarpay_secret_key;
    delete safe.lunarpay_org_token;
    delete safe.password_hash;
    return NextResponse.json({ contact: safe });
  }

  if (type === 'couple') {
    const { data: userResp, error: authErr } = await supabaseAdmin.auth.admin.getUserById(id);
    if (authErr || !userResp?.user) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { data: profile } = await supabaseAdmin
      .from('couple_profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return NextResponse.json({
      contact: {
        id,
        email: userResp.user.email ?? null,
        email_confirmed_at: userResp.user.email_confirmed_at ?? null,
        last_sign_in_at: userResp.user.last_sign_in_at ?? null,
        banned_until: userResp.user.banned_until ?? null,
        ...(profile ?? {}),
      },
    });
  }

  if (type === 'venue_team') {
    const { data, error } = await supabaseAdmin
      .from('venue_team_members')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ contact: data });
  }

  if (type === 'admin_team') {
    const { data, error } = await supabaseAdmin
      .from('support_team_members')
      .select(
        'id, email, name, first_name, last_name, phone, avatar_url, role, active, is_super_admin, admin_tabs_allowed, admin_notes, last_login_at, created_at',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ contact: data });
  }

  if (type === 'lead') {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ contact: data });
  }

  if (type === 'waitlist') {
    const { data, error } = await supabaseAdmin
      .from('waitlist')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ contact: data });
  }

  return NextResponse.json({ error: 'Unsupported' }, { status: 400 });
}

/**
 * PATCH — edit one contact. Accepts a generic shape; the route knows which
 * fields are valid for each contact type and silently drops the rest. Email
 * and password updates are applied to auth.users when the contact is an
 * auth-backed identity (couple, admin_team via support_team_members).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const parsed = await readType(params);
  if (!parsed.ok) return parsed.res;
  const { type, id } = parsed;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // ── venue owner ──────────────────────────────────────────────────────────
  if (type === 'venue_owner') {
    const updates: Record<string, unknown> = compact({
      name:               safeText(body.name) ?? undefined,
      email:              typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined,
      phone:              safeText(body.phone) ?? undefined,
      notification_email: safeText(body.notification_email) ?? undefined,
      notification_phone: safeText(body.notification_phone) ?? undefined,
      owner_first_name:   safeText(body.first_name) ?? undefined,
      owner_last_name:    safeText(body.last_name) ?? undefined,
      address_line1:      safeText(body.address_line1) ?? undefined,
      address_line2:      safeText(body.address_line2) ?? undefined,
      location_city:      safeText(body.city) ?? undefined,
      location_state:     safeText(body.state) ?? undefined,
      postal_code:        safeText(body.postal_code) ?? undefined,
      country:            safeText(body.country) ?? undefined,
      admin_notes:        safeText(body.admin_notes) ?? undefined,
    });
    // Social links live in jsonb on venues.social_links. Allow partial updates.
    const socialPatch: Record<string, string | null> = {};
    for (const k of ['instagram', 'facebook', 'tiktok', 'pinterest', 'youtube', 'twitter', 'website']) {
      if (k in body) socialPatch[k] = safeText((body as Record<string, unknown>)[k]);
    }
    if (Object.keys(socialPatch).length > 0) {
      // Merge with existing
      const { data: existing } = await supabaseAdmin
        .from('venues').select('social_links').eq('id', id).maybeSingle();
      const cur = (existing?.social_links ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...cur };
      for (const [k, v] of Object.entries(socialPatch)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      updates.social_links = merged;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('venues').update(updates).eq('id', id);
    if (error) {
      // Drop unknown columns (legacy schemas)
      const m = error.message.match(/column "?([a-zA-Z_]+)"? .*does not exist/i)
        || error.message.match(/Could not find the '([a-zA-Z_]+)' column/i);
      const col = m?.[1];
      if (col && col in updates) {
        delete updates[col];
        const retry = await supabaseAdmin.from('venues').update(updates).eq('id', id);
        if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 });
      } else {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ── couple ──────────────────────────────────────────────────────────────
  if (type === 'couple') {
    // Auth fields
    const authUpdates: { email?: string; password?: string; email_confirm?: boolean } = {};
    if (typeof body.email === 'string') {
      const e = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
      }
      authUpdates.email = e;
      authUpdates.email_confirm = true;
    }
    if (typeof body.password === 'string' && body.password) {
      if (body.password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
      }
      authUpdates.password = body.password;
    }
    if (Object.keys(authUpdates).length) {
      const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(id, authUpdates);
      if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });
    }

    // Profile fields
    const profile: Record<string, unknown> = compact({
      first_name:    safeText(body.first_name)    ?? undefined,
      last_name:     safeText(body.last_name)     ?? undefined,
      display_name:  safeText(body.display_name)  ?? undefined,
      phone:         safeText(body.phone)         ?? undefined,
      address_line1: safeText(body.address_line1) ?? undefined,
      address_line2: safeText(body.address_line2) ?? undefined,
      city:          safeText(body.city)          ?? undefined,
      state:         safeText(body.state)         ?? undefined,
      postal_code:   safeText(body.postal_code)   ?? undefined,
      country:       safeText(body.country)       ?? undefined,
      instagram_url: safeText(body.instagram_url) ?? undefined,
      facebook_url:  safeText(body.facebook_url)  ?? undefined,
      tiktok_url:    safeText(body.tiktok_url)    ?? undefined,
      pinterest_url: safeText(body.pinterest_url) ?? undefined,
      wedding_date:  typeof body.wedding_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.wedding_date) ? body.wedding_date : undefined,
      admin_notes:   safeText(body.admin_notes)   ?? undefined,
    });
    if (Object.keys(profile).length === 0 && !Object.keys(authUpdates).length) {
      return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
    }
    if (Object.keys(profile).length) {
      profile.updated_at = new Date().toISOString();
      // Ensure profile row exists
      const { data: existing } = await supabaseAdmin
        .from('couple_profiles').select('id').eq('id', id).maybeSingle();
      if (!existing) await supabaseAdmin.from('couple_profiles').insert({ id });

      let { error } = await supabaseAdmin.from('couple_profiles').update(profile).eq('id', id);
      while (error) {
        const m = error.message.match(/column "?([a-zA-Z_]+)"? .*does not exist/i)
          || error.message.match(/Could not find the '([a-zA-Z_]+)' column/i);
        const col = m?.[1];
        if (col && col in profile) {
          delete profile[col];
          if (Object.keys(profile).length === 0) break;
          const retry = await supabaseAdmin.from('couple_profiles').update(profile).eq('id', id);
          error = retry.error ?? null;
        } else {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ── venue team member ───────────────────────────────────────────────────
  if (type === 'venue_team') {
    const updates: Record<string, unknown> = compact({
      first_name:  safeText(body.first_name) ?? undefined,
      last_name:   safeText(body.last_name)  ?? undefined,
      name:        safeText(body.name)       ?? undefined,
      email:       typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined,
      phone:       safeText(body.phone)      ?? undefined,
      role:        safeText(body.role)       ?? undefined,
      status:      safeText(body.status)     ?? undefined,
      admin_notes: safeText(body.admin_notes) ?? undefined,
    });
    // Keep name in sync with first/last
    if (('first_name' in body || 'last_name' in body) && !('name' in body)) {
      const f = safeText(body.first_name) ?? '';
      const l = safeText(body.last_name) ?? '';
      const combined = `${f} ${l}`.trim();
      if (combined) updates.name = combined;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
    }
    let { error } = await supabaseAdmin.from('venue_team_members').update(updates).eq('id', id);
    while (error) {
      const m = error.message.match(/column "?([a-zA-Z_]+)"? .*does not exist/i)
        || error.message.match(/Could not find the '([a-zA-Z_]+)' column/i);
      const col = m?.[1];
      if (col && col in updates) {
        delete updates[col];
        if (Object.keys(updates).length === 0) break;
        const retry = await supabaseAdmin.from('venue_team_members').update(updates).eq('id', id);
        error = retry.error ?? null;
      } else {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ── admin team member ───────────────────────────────────────────────────
  if (type === 'admin_team') {
    const updates: Record<string, unknown> = compact({
      first_name:  safeText(body.first_name)  ?? undefined,
      last_name:   safeText(body.last_name)   ?? undefined,
      name:        safeText(body.name)        ?? undefined,
      email:       typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined,
      phone:       safeText(body.phone)       ?? undefined,
      role:        safeText(body.role)        ?? undefined,
      admin_notes: safeText(body.admin_notes) ?? undefined,
    });
    if (typeof body.password === 'string' && body.password) {
      if (body.password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
      }
      updates.password_hash = await hashSupportPassword(body.password);
    }
    if (('first_name' in body || 'last_name' in body) && !('name' in body)) {
      const f = safeText(body.first_name) ?? '';
      const l = safeText(body.last_name) ?? '';
      const combined = `${f} ${l}`.trim();
      if (combined) updates.name = combined;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
    }
    let { error } = await supabaseAdmin.from('support_team_members').update(updates).eq('id', id);
    while (error) {
      const m = error.message.match(/column "?([a-zA-Z_]+)"? .*does not exist/i)
        || error.message.match(/Could not find the '([a-zA-Z_]+)' column/i);
      const col = m?.[1];
      if (col && col in updates) {
        delete updates[col];
        if (Object.keys(updates).length === 0) break;
        const retry = await supabaseAdmin.from('support_team_members').update(updates).eq('id', id);
        error = retry.error ?? null;
      } else {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ── lead / waitlist — limited fields ────────────────────────────────────
  if (type === 'lead') {
    const updates: Record<string, unknown> = compact({
      name:    safeText(body.name) ?? undefined,
      email:   typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined,
      phone:   safeText(body.phone) ?? undefined,
      status:  safeText(body.status) ?? undefined,
      notes:   safeText(body.notes) ?? undefined,
    });
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from('leads').update(updates).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (type === 'waitlist') {
    const updates: Record<string, unknown> = compact({
      first_name: safeText(body.first_name) ?? undefined,
      last_name:  safeText(body.last_name)  ?? undefined,
      email:      typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined,
      phone:      safeText(body.phone)      ?? undefined,
      venue_name: safeText(body.venue_name) ?? undefined,
    });
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from('waitlist').update(updates).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unsupported' }, { status: 400 });
}

/**
 * DELETE — remove the contact. Some deletions are gated to the master
 * super-admin only (venue owner, admin team) because they cascade hard.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const parsed = await readType(params);
  if (!parsed.ok) return parsed.res;
  const { type, id } = parsed;

  if (type === 'venue_owner') {
    if (!(await verifyMasterAdminOnly())) {
      return NextResponse.json(
        { error: 'Only the master super-admin can delete a venue account.' },
        { status: 403 },
      );
    }
    // Use the existing venue-delete endpoint's logic — best-effort here.
    const { data: venue } = await supabaseAdmin
      .from('venues').select('id, is_demo, owner_id').eq('id', id).maybeSingle();
    if (!venue) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if ((venue as { is_demo?: boolean | null }).is_demo === true) {
      return NextResponse.json({ error: 'Protected demo venue.' }, { status: 403 });
    }
    const { error } = await supabaseAdmin.from('venues').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const ownerId = (venue as { owner_id?: string | null }).owner_id;
    if (ownerId) {
      try { await supabaseAdmin.from('profiles').delete().eq('id', ownerId); } catch {}
      try { await supabaseAdmin.auth.admin.deleteUser(ownerId); } catch {}
    }
    return NextResponse.json({ deleted: true });
  }

  if (type === 'couple') {
    try { await supabaseAdmin.from('couple_profiles').delete().eq('id', id); } catch {}
    try { await supabaseAdmin.from('couple_saved_venues').delete().eq('couple_id', id); } catch {}
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  }

  if (type === 'venue_team') {
    const { error } = await supabaseAdmin.from('venue_team_members').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  }

  if (type === 'admin_team') {
    if (!(await verifyMasterAdminOnly())) {
      return NextResponse.json(
        { error: 'Only the master super-admin can delete an admin team member.' },
        { status: 403 },
      );
    }
    const { error } = await supabaseAdmin.from('support_team_members').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  }

  if (type === 'lead') {
    const { error } = await supabaseAdmin.from('leads').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  }

  if (type === 'waitlist') {
    const { error } = await supabaseAdmin.from('waitlist').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  }

  return NextResponse.json({ error: 'Unsupported' }, { status: 400 });
}
