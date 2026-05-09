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

export type VenueSession = {
  id: string;
  name: string | null;
  email: string | null;
  slug: string | null;
  phone: string | null;
  setup_completed: boolean | null;
  onboarding_status: string | null;
  ghl_connected: boolean | null;
  ghl_access_token: string | null;
  ghl_location_id: string | null;
  lunarpay_merchant_id: string | null;
  lunarpay_secret_key: string | null;
  lunarpay_public_key: string | null;
  brand_color: string | null;
  brand_logo_url: string | null;
  brand_secondary_color: string | null;
  resend_from_email: string | null;
  resend_from_name: string | null;
  resend_api_key: string | null;
  directory_plan_id: string | null;
  directory_subscription_status: string | null;
};

export async function getVenueFromSession(): Promise<VenueSession | null> {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return null;

  const { data } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, email, slug, phone, setup_completed, onboarding_status, ' +
      'ghl_connected, ghl_access_token, ghl_location_id, ' +
      'lunarpay_merchant_id, lunarpay_secret_key, lunarpay_public_key, ' +
      'brand_color, brand_logo_url, brand_secondary_color, ' +
      'resend_from_email, resend_from_name, resend_api_key, ' +
      'directory_plan_id, directory_subscription_status',
    )
    .eq('id', venueId)
    .single();

  return data as VenueSession | null;
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
