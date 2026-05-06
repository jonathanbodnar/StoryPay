/**
 * Resolve the venue user's identity (owner profile vs team member) for
 * support-ticket attribution. Mirrors the existing dashboard cookie scheme:
 *   - venue_id cookie  -> the venue
 *   - member_id cookie -> a team member (when present)
 *
 * Owner attribution piggybacks on `venues.owner_id` (== auth.users.id ==
 * profiles.id) when present. StoryVenue authenticates most venue owners
 * with email + bcrypt password against `venues.password_hash`, which never
 * creates an auth.users row — so `venues.owner_id` is typically NULL. In
 * that case both profileId and memberId are returned as NULL and the
 * support ticket is attributed to the venue itself (display name resolved
 * from venues.name / venues.email). The relaxed CHECK constraint added in
 * migration 111 permits this null-null insert path for owner-opened
 * tickets.
 */
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export interface VenueAttribution {
  venueId:      string;
  profileId:    string | null;   // owner's auth.users.id (when present)
  memberId:     string | null;   // venue_team_members.id (when team member)
  displayName:  string;
  /** Best-effort owner email when profileId is null. Used by admin UIs to
   *  show "From: <email>" for venue-only attribution. */
  ownerEmail:   string | null;
  /** True when the signed-in user is the venue owner (regardless of whether
   *  they have a profiles row). False for team-member sessions. */
  isOwner:      boolean;
}

export async function resolveVenueAttribution(): Promise<VenueAttribution | { error: string }> {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return { error: 'Not signed in to a venue' };

  const memberId = c.get('member_id')?.value || null;

  // Team-member path
  if (memberId) {
    const { data: m } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, first_name, last_name, email, venue_id, status')
      .eq('id', memberId)
      .maybeSingle();
    if (!m) return { error: 'Team member not found' };
    if (m.venue_id !== venueId) return { error: 'Team member does not belong to this venue' };
    if (m.status === 'inactive') return { error: 'Team member is not active' };
    const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.email || 'Team member';
    return {
      venueId,
      profileId:   null,
      memberId:    m.id,
      displayName: name,
      ownerEmail:  null,
      isOwner:     false,
    };
  }

  // Owner path — venue itself is the actor.
  const { data: v } = await supabaseAdmin
    .from('venues')
    .select('id, owner_id, name, email')
    .eq('id', venueId)
    .maybeSingle();
  if (!v) return { error: 'Venue not found' };

  // If we have a profiles-linked owner, prefer that (richer attribution).
  if (v.owner_id) {
    const { data: p } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .eq('id', v.owner_id)
      .maybeSingle();

    return {
      venueId,
      profileId:   v.owner_id as string,
      memberId:    null,
      displayName: (p?.full_name as string | null) || (v.name as string | null) || 'Venue owner',
      ownerEmail:  (v.email as string | null) ?? null,
      isOwner:     true,
    };
  }

  // No profiles row — owner authenticates with the venue's bcrypt password
  // hash. Allowed by the relaxed CHECK in migration 111. Display falls back
  // to venue name / email.
  return {
    venueId,
    profileId:   null,
    memberId:    null,
    displayName: (v.name as string | null) || (v.email as string | null) || 'Venue owner',
    ownerEmail:  (v.email as string | null) ?? null,
    isOwner:     true,
  };
}
