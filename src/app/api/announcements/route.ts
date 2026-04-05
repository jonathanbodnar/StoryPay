import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Public endpoint — returns active announcements for the dashboard ticker
export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json([], { status: 200 });

  const { data } = await supabaseAdmin
    .from('announcements')
    .select('id, message, link_text, link_url')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  return NextResponse.json(data ?? []);
}
