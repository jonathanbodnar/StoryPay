import { cookies } from 'next/headers';
import { supabaseAdmin } from './supabase';

export async function getVenueId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get('venue_id')?.value ?? null;
}

export async function requireVenueId(): Promise<string> {
  const id = await getVenueId();
  if (!id) throw new Error('Unauthorized');
  return id;
}

export async function getMemberName(): Promise<string | null> {
  const cookieStore = await cookies();
  const memberId = cookieStore.get('member_id')?.value;
  if (!memberId) return null;
  const { data } = await supabaseAdmin
    .from('venue_team_members')
    .select('first_name, last_name')
    .eq('id', memberId)
    .single();
  if (!data) return null;
  return [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
}
