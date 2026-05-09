/**
 * POST /api/venues/me/delete
 *
 * Permanently deletes the authenticated venue and all associated data.
 * Only the venue owner (role === 'owner') can call this.
 * Requires: { confirmName, confirmPassword } — venue name + current password.
 * Blocked when: active LunarPay subscription, active proposals (paid/signed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  const memberId = c.get('member_id')?.value;

  if (!venueId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Only the venue owner may delete the account
  if (memberId) {
    const { data: member } = await supabaseAdmin
      .from('venue_team_members')
      .select('role')
      .eq('id', memberId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!member || member.role !== 'owner') {
      return NextResponse.json({ error: 'Only the venue owner can delete this account' }, { status: 403 });
    }
  }

  // Parse confirmation
  let body: { confirmName?: string; confirmPassword?: string };
  try { body = await request.json(); } catch { body = {}; }

  // Fetch venue + password hash to validate both confirmations
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, owner_id, password_hash, directory_subscription_status, lunarpay_merchant_id')
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // 1. Venue name must match exactly
  if (!body.confirmName || body.confirmName.trim() !== (venue.name as string).trim()) {
    return NextResponse.json({ error: 'Confirmation name does not match.' }, { status: 400 });
  }

  // 2. Current password must be correct — prevents cookie-theft-only account wipe
  const pwHash = (venue as { password_hash?: string | null }).password_hash;
  if (!body.confirmPassword?.trim()) {
    return NextResponse.json({ error: 'Your current password is required to delete the account.' }, { status: 400 });
  }
  if (!pwHash) {
    return NextResponse.json(
      { error: 'Your account uses magic-link login. Please contact support to delete your account.' },
      { status: 400 },
    );
  }
  const passwordValid = await bcrypt.compare(body.confirmPassword.trim(), pwHash);
  if (!passwordValid) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 400 });
  }

  // 3. Block deletion when an active SaaS subscription exists — cancelling
  //    billing first prevents orphaned subscriptions at LunarPay.
  const subStatus = (venue as { directory_subscription_status?: string | null }).directory_subscription_status;
  if (subStatus === 'active' || subStatus === 'trialing') {
    return NextResponse.json(
      { error: 'You have an active subscription. Please cancel your plan before deleting your account.' },
      { status: 409 },
    );
  }

  // 4. Block deletion when open/signed proposals exist — venues have legal
  //    obligations on signed contracts; hard-deleting them creates liability.
  const { count: openProposals } = await supabaseAdmin
    .from('proposals')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .in('status', ['sent', 'opened', 'signed', 'paid']);
  if ((openProposals ?? 0) > 0) {
    return NextResponse.json(
      { error: `You have ${openProposals} active or signed proposal${(openProposals ?? 0) !== 1 ? 's' : ''}. Please resolve them before deleting your account.` },
      { status: 409 },
    );
  }

  // Best-effort storage cleanup
  try {
    const buckets = [
      { bucket: 'venue-images', prefix: `${venueId}/` },
      { bucket: 'venue-assets', prefix: `venue-logos/${venueId}/` },
      { bucket: 'venue-assets', prefix: `venue-covers/${venueId}/` },
    ];
    for (const { bucket, prefix } of buckets) {
      const { data: files } = await supabaseAdmin.storage.from(bucket).list(prefix, { limit: 1000 });
      if (files && files.length > 0) {
        const paths = files.map((f: { name: string }) => `${prefix}${f.name}`);
        await supabaseAdmin.storage.from(bucket).remove(paths);
      }
    }
  } catch { /* non-fatal */ }

  // Delete venue row — cascade handles all related rows
  const { error } = await supabaseAdmin.from('venues').delete().eq('id', venueId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Delete the Supabase Auth user + profile so the email can be reused for a new account
  const ownerId = (venue as { owner_id?: string | null }).owner_id;
  if (ownerId) {
    try {
      await supabaseAdmin.from('profiles').delete().eq('id', ownerId);
    } catch (e) {
      console.warn('[venues/me/delete] profile deletion failed (non-fatal):', e);
    }
    try {
      await supabaseAdmin.auth.admin.deleteUser(ownerId);
    } catch (e) {
      console.warn('[venues/me/delete] auth user deletion failed (non-fatal):', e);
    }
  }

  // Clear session cookies
  const response = NextResponse.json({ deleted: true });
  response.cookies.delete('venue_id');
  response.cookies.delete('member_id');
  return response;
}
