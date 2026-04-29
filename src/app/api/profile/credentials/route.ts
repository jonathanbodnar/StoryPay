/**
 * PATCH /api/profile/credentials
 *
 * Allows a venue owner to update their login email and/or password.
 *
 * - Email change: updates venues.email + syncs auth.users email via supabaseAdmin
 * - Password change: verifies current password, hashes new one, updates venues.password_hash
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

  // Fetch venue with current credentials
  const { data: venue, error: fetchErr } = await supabaseAdmin
    .from('venues')
    .select('id, email, password_hash, owner_id')
    .eq('id', venueId)
    .single();

  if (fetchErr || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const body = await req.json() as {
    action: 'email' | 'password';
    // email update
    new_email?: string;
    current_password_for_email?: string;
    // password update
    current_password?: string;
    new_password?: string;
    confirm_password?: string;
  };

  // ── Email update ─────────────────────────────────────────────────────────
  if (body.action === 'email') {
    const newEmail = (body.new_email ?? '').trim().toLowerCase();
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }
    if (newEmail === venue.email?.toLowerCase()) {
      return NextResponse.json({ error: 'That is already your current email.' }, { status: 400 });
    }

    // Require password confirmation if they have one set
    if (venue.password_hash) {
      const pass = (body.current_password_for_email ?? '').trim();
      if (!pass) {
        return NextResponse.json({ error: 'Please enter your current password to confirm the email change.' }, { status: 400 });
      }
      const valid = await bcrypt.compare(pass, venue.password_hash);
      if (!valid) {
        return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
      }
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

    // Update venues table
    const { error: updateErr } = await supabaseAdmin
      .from('venues')
      .update({ email: newEmail })
      .eq('id', venueId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Sync Supabase Auth user email (best-effort — non-fatal)
    if (venue.owner_id) {
      await supabaseAdmin.auth.admin.updateUserById(venue.owner_id, { email: newEmail }).catch(() => {});
    }

    return NextResponse.json({ ok: true, email: newEmail });
  }

  // ── Password update ───────────────────────────────────────────────────────
  if (body.action === 'password') {
    const currentPass  = (body.current_password  ?? '').trim();
    const newPass      = (body.new_password       ?? '').trim();
    const confirmPass  = (body.confirm_password   ?? '').trim();

    if (!newPass)    return NextResponse.json({ error: 'New password is required.' }, { status: 400 });
    if (newPass.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    if (newPass !== confirmPass) return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 });

    // Verify current password if they have one set
    if (venue.password_hash) {
      if (!currentPass) {
        return NextResponse.json({ error: 'Current password is required.' }, { status: 400 });
      }
      const valid = await bcrypt.compare(currentPass, venue.password_hash);
      if (!valid) {
        return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
      }
    }

    const newHash = await bcrypt.hash(newPass, 12);
    const { error: updateErr } = await supabaseAdmin
      .from('venues')
      .update({ password_hash: newHash })
      .eq('id', venueId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Also update Supabase Auth password (best-effort)
    if (venue.owner_id) {
      await supabaseAdmin.auth.admin.updateUserById(venue.owner_id, { password: newPass }).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action. Use "email" or "password".' }, { status: 400 });
}
