import { cookies } from 'next/headers';
import { teamMemberForBrowser } from '@/lib/team-member-shape';
import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';
import { normalizePhone } from '@/lib/ghl';
import { revokeMemberSessions } from '@/lib/session-revoke';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const updates: Record<string, string | boolean | null> = {};
  if (body.first_name != null) updates.first_name = body.first_name;
  if (body.last_name  != null) updates.last_name  = body.last_name;
  if (body.email      != null) updates.email      = body.email;
  if (body.role       != null) updates.role       = body.role;
  if (body.status     != null) updates.status     = body.status;
  if (body.phone      != null) {
    const trimmed = String(body.phone).trim();
    if (!trimmed) {
      updates.phone = null;
    } else {
      const normalized = normalizePhone(trimmed);
      if (!normalized) {
        return NextResponse.json({ error: 'Enter a valid mobile phone number' }, { status: 400 });
      }
      updates.phone = normalized;
    }
  }
  if (body.hide_revenue !== undefined && typeof body.hide_revenue === 'boolean') {
    if (session.memberId !== null) {
      return NextResponse.json({ error: 'Only the venue owner can change revenue visibility' }, { status: 403 });
    }
    updates.hide_revenue = body.hide_revenue;
  }
  if (body.password != null && typeof body.password === 'string') {
    if (session.memberId !== null) {
      return NextResponse.json({ error: 'Only the venue owner can set a team member password' }, { status: 403 });
    }
    if (body.password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    updates.password_hash = await hash(body.password, 10);
  }

  // ── Who may change what ────────────────────────────────────────────────────
  // The owner manages everyone. An admin manages team members with the Member
  // role (names, phone, email, status) but can't change roles or edit admins.
  // Anyone may update their own name and phone; nothing else about themselves.
  // Only the owner edits the owner's own login (email, phone, password).
  const isSelf = session.memberId !== null && session.memberId === id;
  const isOwnerSession = session.isOwner; // the account owner, or a team member with the Owner role
  const forbidden = (msg: string) => NextResponse.json({ error: msg }, { status: 403 });

  // ── Who are we editing? ────────────────────────────────────────────────────
  // The team list contains two different kinds of row: real `venue_team_members`
  // rows, and a SYNTHESISED owner row whose id is `venues.owner_id` (see
  // GET /api/team). The owner has no venue_team_members row, which is why an
  // update aimed only at that table matched zero rows and surfaced PostgREST's
  // raw "Cannot coerce the result to a single JSON object" error.
  const { data: memberRow, error: memberLookupErr } = await supabaseAdmin
    .from('venue_team_members')
    .select('id, first_name, last_name, email, phone, role, status')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (memberLookupErr) {
    console.error('[team PATCH] member lookup:', memberLookupErr.message);
    return NextResponse.json({ error: 'Could not load that team member' }, { status: 500 });
  }

  if (memberRow) {
    if (updates.role === 'owner') return forbidden('The owner role can’t be given from the team list.');
    if (isSelf && !isOwnerSession) {
      // The edit form sends every field; unchanged ones are fine.
      const current = memberRow as { email?: string | null; role?: string | null; status?: string | null };
      const changed = Object.keys(updates).filter((k) => {
        if (k === 'first_name' || k === 'last_name' || k === 'phone') return false;
        if (k === 'email') return String(updates.email ?? '').trim().toLowerCase() !== String(current.email ?? '').trim().toLowerCase();
        if (k === 'role') return updates.role !== current.role;
        if (k === 'status') return updates.status !== current.status;
        return true;
      });
      if (changed.length) {
        return forbidden('You can change your own name and phone here. Ask the venue owner for anything else.');
      }
    } else if (!isOwnerSession) {
      if (!session.isAdmin) return forbidden('Only the venue owner or an admin can edit team members.');
      if ((memberRow as { role?: string | null }).role !== 'member') return forbidden('Only the venue owner can edit an admin.');
      if (updates.role != null && updates.role !== 'member') return forbidden('Only the venue owner can change roles.');
    }

    // Keep the denormalised name column in sync
    if (updates.first_name != null || updates.last_name != null) {
      const fn = (updates.first_name as string | undefined) ?? memberRow.first_name ?? '';
      const ln = (updates.last_name  as string | undefined) ?? memberRow.last_name  ?? '';
      updates.name = [fn, ln].filter(Boolean).join(' ');
    }

    const { data, error } = await supabaseAdmin
      .from('venue_team_members')
      .update(updates)
      .eq('id', id)
      .eq('venue_id', venueId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[team PATCH] member update:', error.message);
      return NextResponse.json({ error: 'Could not save those changes' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
    return NextResponse.json(teamMemberForBrowser(data as Record<string, unknown>));
  }

  // ── Venue owner fallback ───────────────────────────────────────────────────
  // The owner's account lives on the venues row: password_hash, phone, email and
  // owner_first_name / owner_last_name. Writing here is the fix.
  const { data: venue, error: venueErr } = await supabaseAdmin
    .from('venues')
    .select('id, owner_id, owner_first_name, owner_last_name, email, phone')
    .eq('id', venueId)
    .maybeSingle();

  if (venueErr) {
    console.error('[team PATCH] venue lookup:', venueErr.message);
    return NextResponse.json({ error: 'Could not load this account' }, { status: 500 });
  }

  const isOwner = !!venue?.owner_id && venue.owner_id === id;
  if (!isOwner) {
    return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
  }
  if (!isOwnerSession) return forbidden('Only the venue owner can change the owner’s details.');

  // The owner cannot be demoted from this modal — they own the account.
  if (updates.role != null && updates.role !== 'owner') {
    return NextResponse.json(
      { error: 'The venue owner’s role cannot be changed here.' },
      { status: 400 },
    );
  }

  // The owner's sign-in email and password are not changed here. Until Oct 7
  // 2026 they were, for anyone signed in as an owner and with nothing else
  // asked: the gap My Profile closed the day before, still open by this door.
  // They have one door: My Profile, which asks for the current password.
  const sameEmail = String(updates.email ?? '').trim().toLowerCase() === String(venue.email ?? '').trim().toLowerCase();
  if ((updates.email !== undefined && !sameEmail) || updates.password_hash !== undefined) {
    return NextResponse.json(
      { error: 'Change the owner’s sign-in email or password in My Profile, under Login & Security.' },
      { status: 400 },
    );
  }

  const ownerUpdates: Record<string, string | null> = {};
  if (updates.first_name !== undefined) ownerUpdates.owner_first_name = (updates.first_name as string) || null;
  if (updates.last_name  !== undefined) ownerUpdates.owner_last_name  = (updates.last_name  as string) || null;
  if (updates.phone      !== undefined) ownerUpdates.phone            = updates.phone as string | null;
  // `hide_revenue` and `status` are team-member concepts and have no venues
  // column, so they are intentionally ignored for the owner.

  if (Object.keys(ownerUpdates).length > 0) {
    const { error } = await supabaseAdmin
      .from('venues')
      .update(ownerUpdates)
      .eq('id', venueId);

    if (error) {
      console.error('[team PATCH] owner update:', error.message);
      return NextResponse.json({ error: 'Could not save those changes' }, { status: 500 });
    }
  }

  // Return the same shape the team list uses for the synthesised owner row, so
  // the client's in-place list update keeps working.
  return NextResponse.json({
    id:         venue.owner_id,
    venue_id:   venueId,
    first_name: ownerUpdates.owner_first_name ?? venue.owner_first_name ?? '',
    last_name:  ownerUpdates.owner_last_name  ?? venue.owner_last_name  ?? '',
    email:      ownerUpdates.email            ?? venue.email            ?? '',
    phone:      ownerUpdates.phone            ?? venue.phone            ?? null,
    role:       'owner',
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // The owner removes anyone; an admin removes members with the Member role.
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: target } = await supabaseAdmin
    .from('venue_team_members')
    .select('id, role')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
  const isOwnerSession = session.isOwner; // the account owner, or a team member with the Owner role
  if (!isOwnerSession) {
    if (!session.isAdmin) return NextResponse.json({ error: 'Only the venue owner or an admin can remove team members.' }, { status: 403 });
    if ((target as { role?: string | null }).role !== 'member') {
      return NextResponse.json({ error: 'Only the venue owner can remove an admin.' }, { status: 403 });
    }
  }

  // Their open sessions end with the row (the proxy signs out a member whose
  // record is gone); stamping the revocation first covers any cached check.
  await revokeMemberSessions(id).catch(() => {});
  const { error } = await supabaseAdmin
    .from('venue_team_members')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
