import { cookies } from 'next/headers';
import { supabaseAdmin } from './supabase';

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

export async function getAdminFromSession() {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get('admin_token')?.value;
  if (!adminToken || adminToken !== process.env.ADMIN_SECRET) return null;
  return { authenticated: true };
}
