import { cookies } from 'next/headers';
import { supabaseAdmin } from './supabase';

export type UserRole = 'owner' | 'admin' | 'member';

export interface SessionUser {
  venueId: string;
  venueName: string;
  role: UserRole;
  memberId: string | null;       // null = venue owner (logged in via magic link)
  memberName: string | null;
  memberEmail: string | null;
  isOwner: boolean;
  isAdmin: boolean;               // owner OR admin
  /** When true (team members), hide revenue/opportunity dollar amounts in CRM UI */
  hideRevenue: boolean;
}

export async function getVenueFromSession() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return null;

  const { data } = await supabaseAdmin
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .single();

  return data;
}

/**
 * Returns full session context including role.
 * - If member_id cookie is set → team member session (role from venue_team_members)
 * - Otherwise → venue owner session (role = 'owner')
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const venueId  = cookieStore.get('venue_id')?.value;
  if (!venueId) return null;

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, setup_completed')
    .eq('id', venueId)
    .single();

  if (!venue) return null;

  const memberId = cookieStore.get('member_id')?.value;

  if (memberId) {
    // Team member session
    const { data: member } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, first_name, last_name, name, email, role, hide_revenue')
      .eq('id', memberId)
      .eq('venue_id', venueId)
      .single();

    if (!member) {
      // Invalid member cookie — treat as owner fallback
      return {
        venueId, venueName: venue.name, role: 'owner',
        memberId: null, memberName: null, memberEmail: null,
        isOwner: true, isAdmin: true,
        hideRevenue: false,
      };
    }

    const role = (member.role as UserRole) || 'member';
    const hideRev = Boolean((member as { hide_revenue?: boolean }).hide_revenue);
    return {
      venueId,
      venueName: venue.name,
      role,
      memberId: member.id,
      memberName: [member.first_name, member.last_name].filter(Boolean).join(' ') || member.name || null,
      memberEmail: member.email || null,
      isOwner: role === 'owner',
      isAdmin: role === 'owner' || role === 'admin',
      hideRevenue: hideRev,
    };
  }

  // Venue owner session (no member_id cookie)
  return {
    venueId,
    venueName: venue.name,
    role: 'owner',
    memberId: null,
    memberName: null,
    memberEmail: null,
    isOwner: true,
    isAdmin: true,
    hideRevenue: false,
  };
}

export async function getAdminFromSession() {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get('admin_token')?.value;
  if (!adminToken || adminToken !== process.env.ADMIN_SECRET) return null;
  return { authenticated: true };
}
