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
    .select('id, name, email, phone, owner_id, owner_first_name, owner_last_name')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Names are stored directly on venues (owner_first_name / owner_last_name).
  // Fall back to splitting profiles.full_name for accounts created before
  // migration 070.
  let firstName = (venue as Record<string, unknown>).owner_first_name as string | null ?? '';
  let lastName  = (venue as Record<string, unknown>).owner_last_name  as string | null ?? '';

  if (!firstName && venue.owner_id) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', venue.owner_id)
      .maybeSingle();
    if (profile?.full_name) {
      const parts = profile.full_name.trim().split(/\s+/);
      firstName = parts[0] ?? '';
      lastName  = parts.slice(1).join(' ');
    }
  }

  return NextResponse.json({
    type:       'owner',
    id:         venue.id,
    first_name: firstName,
    last_name:  lastName,
    full_name:  [firstName, lastName].filter(Boolean).join(' '),
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
  // Validate required owner fields
  const email     = (body.email     ?? '').trim().toLowerCase();
  const phone     = (body.phone     ?? '').trim();
  const firstName = (body.first_name ?? '').trim();
  const lastName  = (body.last_name  ?? '').trim();
  if (!firstName) return NextResponse.json({ error: 'First name is required.' }, { status: 400 });
  if (!email)     return NextResponse.json({ error: 'Email is required.' },      { status: 400 });
  if (!phone)     return NextResponse.json({ error: 'Phone is required.' },      { status: 400 });

  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  // Store names directly on the venues row (no FK dependency, always reliable).
  // Also keep profiles.full_name in sync for backward compat where owner_id is set.
  const { error: venueErr } = await supabaseAdmin
    .from('venues')
    .update({ email, phone, owner_first_name: firstName, owner_last_name: lastName } as Record<string, unknown>)
    .eq('id', venueId);

  if (venueErr) return NextResponse.json({ error: venueErr.message }, { status: 500 });

  // Best-effort: also sync profiles.full_name (ignore errors — non-critical)
  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select('owner_id')
    .eq('id', venueId)
    .single();
  if (venueRow?.owner_id) {
    await supabaseAdmin
      .from('profiles')
      .upsert({ id: venueRow.owner_id, full_name: fullName }, { onConflict: 'id' });
  }

  return NextResponse.json({ ok: true, first_name: firstName, last_name: lastName, full_name: fullName });
}
