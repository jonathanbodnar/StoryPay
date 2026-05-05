/**
 * Resolve the venue user's identity (owner profile vs team member) for
 * support-ticket attribution. Mirrors the existing dashboard cookie scheme:
 *   - venue_id cookie  -> the venue
 *   - member_id cookie -> a team member (when present)
 *
 * Owner attribution piggybacks on `venues.owner_id` (== auth.users.id ==
 * profiles.id), so opened_by_profile_id can be set without a separate session.
 */
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export interface VenueAttribution {
  venueId:      string;
  profileId:    string | null;   // owner's auth.users.id
  memberId:     string | null;   // venue_team_members.id
  displayName:  string;
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
    return { venueId, profileId: null, memberId: m.id, displayName: name };
  }

  // Owner path — look up venues.owner_id
  const { data: v } = await supabaseAdmin
    .from('venues')
    .select('id, owner_id, name')
    .eq('id', venueId)
    .maybeSingle();
  if (!v) return { error: 'Venue not found' };
  if (!v.owner_id) {
    return { error: 'Venue has no owner profile yet — cannot attribute support tickets' };
  }

  // Best-effort name from profiles
  const { data: p } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .eq('id', v.owner_id)
    .maybeSingle();

  return {
    venueId,
    profileId:   v.owner_id,
    memberId:    null,
    displayName: (p?.full_name as string | null) || (v.name as string | null) || 'Venue owner',
  };
}
