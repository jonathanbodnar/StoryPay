import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json([]);
  const { data } = await supabaseAdmin.rpc('get_active_announcements');
  return NextResponse.json(data ?? []);
}
