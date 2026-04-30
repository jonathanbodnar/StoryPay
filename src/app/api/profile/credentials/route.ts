/**
 * PATCH /api/profile/credentials
 *
 * Allows a venue owner to update their login email or password with no
 * current-password confirmation required.
 *
 * - Email change: updates venues.email + syncs auth.users email
 * - Password change: hashes new password, updates venues.password_hash
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue, error: fetchErr } = await supabaseAdmin
    .from('venues')
    .select('id, email, owner_id')
    .eq('id', venueId)
    .single();

  if (fetchErr || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const body = await req.json() as {
    action: 'email' | 'password';
    new_email?: string;
    new_password?: string;
    confirm_password?: string;
  };

  // ── Email update ─────────────────────────────────────────────────────────
  if (body.action === 'email') {
    const newEmail = (body.new_email ?? '').trim().toLowerCase();
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }
    if (newEmail === (venue.email as string | null)?.toLowerCase()) {
      return NextResponse.json({ error: 'That is already your current email.' }, { status: 400 });
    }

    // Check email isn't already taken by another venue
    const { data: existing } = await supabaseAdmin
      .from('venues')
      .select('id')
      .ilike('email', newEmail)
      .neq('id', venueId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'That email is already in use by another account.' }, { status: 409 });
    }

    const { error: updateErr } = await supabaseAdmin
      .from('venues')
      .update({ email: newEmail })
      .eq('id', venueId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Sync Supabase Auth user email (best-effort)
    if (venue.owner_id) {
      await supabaseAdmin.auth.admin
        .updateUserById(venue.owner_id as string, { email: newEmail, email_confirm: true })
        .catch(() => {});
    }

    return NextResponse.json({ ok: true, email: newEmail });
  }

  // ── Password update ───────────────────────────────────────────────────────
  if (body.action === 'password') {
    const newPass     = (body.new_password     ?? '').trim();
    const confirmPass = (body.confirm_password  ?? '').trim();

    if (!newPass) return NextResponse.json({ error: 'New password is required.' }, { status: 400 });
    if (newPass.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    if (newPass !== confirmPass) return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 });

    const newHash = await bcrypt.hash(newPass, 12);
    const { error: updateErr } = await supabaseAdmin
      .from('venues')
      .update({ password_hash: newHash })
      .eq('id', venueId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Sync Supabase Auth password (best-effort)
    if (venue.owner_id) {
      await supabaseAdmin.auth.admin
        .updateUserById(venue.owner_id as string, { password: newPass })
        .catch(() => {});
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
}
