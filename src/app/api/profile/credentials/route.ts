/**
 * PATCH /api/profile/credentials
 *
 * Updates login credentials for the current session:
 *
 * Venue owners:
 *   - Email change: updates venues.email + syncs auth.users email
 *   - Password change: hashes new password, updates venues.password_hash
 *
 * Team members:
 *   - Password change only: hashes new password, updates
 *     venue_team_members.password_hash (migration 177). Sign-in then
 *     checks this hash first, falling back to invite_token for members
 *     who haven't set a password yet.
 *
 * Either change needs the current password when the account has one
 * (lib/current-password): a signed-in browser alone can't take an account.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import bcrypt from 'bcryptjs';
import { getSessionMemberId } from '@/lib/auth-helpers';
import { checkCurrentPassword, type CurrentPasswordCheck } from '@/lib/current-password';
import { signInEmailTaken } from '@/lib/sign-in-email';

export const dynamic = 'force-dynamic';

function refused(check: Extract<CurrentPasswordCheck, { ok: false }>) {
  return NextResponse.json(
    { error: check.error },
    { status: check.status, headers: check.retryAfterSeconds ? { 'Retry-After': String(check.retryAfterSeconds) } : undefined },
  );
}

export async function PATCH(req: NextRequest) {
  const cookieStore = await cookies();
  const venueId  = cookieStore.get('venue_id')?.value;
  const memberId = (await getSessionMemberId()) ?? undefined;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Team member password change ───────────────────────────────────────────
  if (memberId) {
    const body = await req.json() as {
      action: 'password';
      current_password?: string;
      new_password?: string;
      confirm_password?: string;
    };
    if (body.action !== 'password') {
      return NextResponse.json({ error: 'Team members can only update their password.' }, { status: 400 });
    }

    const newPass     = (body.new_password    ?? '').trim();
    const confirmPass = (body.confirm_password ?? '').trim();
    if (!newPass)              return NextResponse.json({ error: 'New password is required.' },                    { status: 400 });
    if (newPass.length < 8)   return NextResponse.json({ error: 'Password must be at least 8 characters.' },     { status: 400 });
    if (newPass !== confirmPass) return NextResponse.json({ error: 'Passwords do not match.' },                   { status: 400 });

    const { data: member } = await supabaseAdmin
      .from('venue_team_members')
      .select('password_hash')
      .eq('id', memberId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    const allowed = await checkCurrentPassword(`member:${memberId}`, (member as { password_hash?: string | null }).password_hash, body.current_password);
    if (!allowed.ok) return refused(allowed);

    const newHash = await bcrypt.hash(newPass, 12);
    const { error: updateErr } = await supabaseAdmin
      .from('venue_team_members')
      .update({ password_hash: newHash })
      .eq('id', memberId)
      .eq('venue_id', venueId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  const { data: venue, error: fetchErr } = await supabaseAdmin
    .from('venues')
    .select('id, email, owner_id, password_hash')
    .eq('id', venueId)
    .single();

  if (fetchErr || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const body = await req.json() as {
    action: 'email' | 'password';
    current_password?: string;
    new_email?: string;
    new_password?: string;
    confirm_password?: string;
  };

  const currentHash = (venue as { password_hash?: string | null }).password_hash;

  // ── Email update ─────────────────────────────────────────────────────────
  if (body.action === 'email') {
    const newEmail = (body.new_email ?? '').trim().toLowerCase();
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }
    if (newEmail === (venue.email as string | null)?.toLowerCase()) {
      return NextResponse.json({ error: 'That is already your current email.' }, { status: 400 });
    }

    // Asked before anything is said about other accounts: only the owner
    // learns whether an address is taken.
    const allowed = await checkCurrentPassword(`venue:${venueId}`, currentHash, body.current_password);
    if (!allowed.ok) return refused(allowed);

    // Another account, an owner's or a team member's, must not sign in with it already.
    if (await signInEmailTaken(newEmail, { venueId })) {
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

    const allowed = await checkCurrentPassword(`venue:${venueId}`, currentHash, body.current_password);
    if (!allowed.ok) return refused(allowed);

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
