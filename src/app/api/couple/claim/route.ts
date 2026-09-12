import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { type CoupleWeddingRow } from '@/lib/couple-weddings';
import { sendWeddingHubConnectedEmail } from '@/lib/wedding-hub-emails';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/couple/claim
 * Bride accepts a venue -> bride portal invite. Two ways in:
 *   - { token }    : from the emailed claim link (secret token).
 *   - { inviteId } : from the in-dashboard "Accept" button, verified by matching
 *                    the invite's invited_email to the bride's account email.
 */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { token?: string; inviteId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const token = (body.token ?? '').trim();
  const inviteId = (body.inviteId ?? '').trim();
  if (!token && !inviteId) {
    return NextResponse.json({ error: 'token or inviteId is required' }, { status: 400 });
  }

  let invite: CoupleWeddingRow | null = null;
  if (token) {
    const { data } = await supabaseAdmin
      .from('couple_weddings')
      .select('*')
      .eq('claim_token', token)
      .eq('initiated_by', 'venue')
      .maybeSingle();
    invite = data as CoupleWeddingRow | null;
  } else {
    const { data } = await supabaseAdmin
      .from('couple_weddings')
      .select('*')
      .eq('id', inviteId)
      .eq('initiated_by', 'venue')
      .maybeSingle();
    invite = data as CoupleWeddingRow | null;
    // Email-verified path: the surfaced invite must be addressed to this bride.
    const inviteEmail = (invite?.invited_email ?? '').trim().toLowerCase();
    const userEmail = (user.email ?? '').trim().toLowerCase();
    if (invite && (!inviteEmail || !userEmail || inviteEmail !== userEmail)) {
      return NextResponse.json({ error: 'This invite is not addressed to your account.' }, { status: 403 });
    }
  }

  if (!invite || invite.status !== 'pending') {
    return NextResponse.json({ error: 'This invite is no longer valid.' }, { status: 404 });
  }
  if (invite.couple_id && invite.couple_id !== user.id) {
    return NextResponse.json({ error: 'This invite has already been claimed.' }, { status: 409 });
  }
  if (invite.claim_token_expires_at && new Date(invite.claim_token_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This invite has expired. Ask your venue to resend it.' }, { status: 410 });
  }

  // One active wedding per couple: block if already linked to a different venue.
  const { data: linkedElsewhere } = await supabaseAdmin
    .from('couple_weddings')
    .select('id, venue_id')
    .eq('couple_id', user.id)
    .eq('status', 'linked')
    .neq('venue_id', invite.venue_id)
    .limit(1)
    .maybeSingle();
  if (linkedElsewhere) {
    return NextResponse.json(
      { error: 'You are already connected to another venue. Disconnect there first to accept this invite.' },
      { status: 409 },
    );
  }

  // Clear any of the bride's other pending/linked rows so this becomes the one
  // active wedding (e.g. a pending self-request she made earlier).
  await supabaseAdmin
    .from('couple_weddings')
    .update({ status: 'revoked', decided_at: new Date().toISOString() })
    .eq('couple_id', user.id)
    .in('status', ['pending', 'linked'])
    .neq('id', invite.id);

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('couple_weddings')
    .update({
      couple_id: user.id,
      status: 'linked',
      linked_at: now,
      decided_at: now,
      claim_token: null,
      claim_token_expires_at: null,
    })
    .eq('id', invite.id)
    .eq('status', 'pending')
    .select('id, venue_id')
    .single();

  if (updErr || !updated) {
    console.error('[couple/claim]', updErr);
    return NextResponse.json({ error: 'Could not accept this invite. It may have just been claimed.' }, { status: 409 });
  }

  // Best-effort: let the venue know their invite was accepted. Never blocks
  // the claim itself — a bounced/misconfigured notification shouldn't undo it.
  void notifyVenueOfConnection((updated as { venue_id: string }).venue_id, invite);

  return NextResponse.json({ ok: true });
}

async function notifyVenueOfConnection(venueId: string, invite: CoupleWeddingRow): Promise<void> {
  try {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('name, email, notification_email, owner_first_name')
      .eq('id', venueId)
      .maybeSingle();
    if (!venue) return;

    const v = venue as { name: string | null; email: string | null; notification_email: string | null; owner_first_name: string | null };
    const toEmail = (v.notification_email || v.email || '').trim();
    if (!toEmail) return;

    await sendWeddingHubConnectedEmail({
      toEmail,
      ownerFirstName: v.owner_first_name?.trim() || 'there',
      brideName: (invite.invited_name ?? '').trim() || (invite.invited_email ?? '').trim() || 'Your couple',
      venueName: v.name?.trim() || 'your venue',
    });
  } catch (err) {
    console.error('[couple/claim] notifyVenueOfConnection failed:', err);
  }
}
