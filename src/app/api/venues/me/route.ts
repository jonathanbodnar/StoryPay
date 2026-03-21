import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, onboarding_status, ghl_connected, setup_completed, lunarpay_merchant_id')
    .eq('id', venueId)
    .single();

  if (error || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  return NextResponse.json(venue);
}
