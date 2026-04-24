import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// ── GET /api/profile ─────────────────────────────────────────────────────────
// Returns the current user's profile: personal name, login email, phone,
// and role. Works for both venue owners and team members.
export async function GET() {
  const cookieStore = await cookies();
  const venueId   = cookieStore.get('venue_id')?.value;
  const memberId  = cookieStore.get('member_id')?.value;

  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Team member ────────────────────────────────────────────────────────────
  if (memberId) {
    const { data: member } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, first_name, last_name, email, role, status')
      .eq('id', memberId)
      .eq('venue_id', venueId)
      .maybeSingle();

    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

    return NextResponse.json({
      type: 'member',
      id:         member.id,
      first_name: member.first_name ?? '',
      last_name:  member.last_name  ?? '',
      email:      member.email      ?? '',
      role:       member.role       ?? 'member',
      status:     member.status     ?? 'active',
    });
  }

  // ── Venue owner ────────────────────────────────────────────────────────────
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, phone, owner_id')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Try to get the owner's personal name from profiles table
  let ownerFullName: string | null = null;
  if (venue.owner_id) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', venue.owner_id)
      .maybeSingle();
    ownerFullName = profile?.full_name ?? null;
  }

  return NextResponse.json({
    type:       'owner',
    id:         venue.id,
    full_name:  ownerFullName ?? '',
    email:      venue.email   ?? '',
    phone:      venue.phone   ?? '',
    venue_name: venue.name    ?? '',
    owner_id:   venue.owner_id ?? null,
    role:       'owner',
  });
}

// ── PATCH /api/profile ────────────────────────────────────────────────────────
// Updates personal info. For owners: full_name (profiles), email + phone
// (venues). For team members: first_name, last_name, email.
export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId   = cookieStore.get('venue_id')?.value;
  const memberId  = cookieStore.get('member_id')?.value;

  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json() as Record<string, string>;

  // ── Team member ────────────────────────────────────────────────────────────
  if (memberId) {
    const patch: Record<string, string> = {};
    if (body.first_name !== undefined) patch.first_name = body.first_name.trim();
    if (body.last_name  !== undefined) patch.last_name  = body.last_name.trim();
    if (body.email      !== undefined) patch.email      = body.email.trim().toLowerCase();

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('venue_team_members')
      .update(patch)
      .eq('id', memberId)
      .eq('venue_id', venueId)
      .select('id, first_name, last_name, email, role, status')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, member: data });
  }

  // ── Venue owner ────────────────────────────────────────────────────────────
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, owner_id')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Update personal name in profiles table
  if (body.full_name !== undefined && venue.owner_id) {
    await supabaseAdmin
      .from('profiles')
      .update({ full_name: body.full_name.trim() })
      .eq('id', venue.owner_id);
  }

  // Update contact fields on the venues row
  const venuePatch: Record<string, string> = {};
  if (body.email !== undefined) venuePatch.email = body.email.trim().toLowerCase();
  if (body.phone !== undefined) venuePatch.phone = body.phone.trim();

  if (Object.keys(venuePatch).length > 0) {
    const { error } = await supabaseAdmin
      .from('venues')
      .update(venuePatch)
      .eq('id', venueId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
