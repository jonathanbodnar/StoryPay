import { cookies } from 'next/headers';
import { supabaseAdmin } from './supabase';
import { venuePrincipalFromMeta } from './venue-session';

export async function getVenueId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get('venue_id')?.value ?? null;
}

export async function requireVenueId(): Promise<string> {
  const id = await getVenueId();
  if (!id) throw new Error('Unauthorized');
  return id;
}

/**
 * The signed-in team member's id, or null for the owner. Read from the
 * principal in the signed venue_id meta when present, so clearing the
 * member_id cookie can't turn a member into the owner.
 */
export async function getSessionMemberId(): Promise<string | null> {
  const cookieStore = await cookies();
  const principal = venuePrincipalFromMeta(cookieStore.get('venue_id_meta')?.value);
  if (principal.kind === 'member') return principal.memberId;
  if (principal.kind === 'owner') return null;
  return cookieStore.get('member_id')?.value ?? null;
}

export async function getMemberName(): Promise<string | null> {
  const memberId = await getSessionMemberId();
  if (!memberId) return null;
  const { data } = await supabaseAdmin
    .from('venue_team_members')
    .select('first_name, last_name')
    .eq('id', memberId)
    .single();
  if (!data) return null;
  return [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
}
