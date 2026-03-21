import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .select('onboarding_status, ghl_connected')
    .eq('id', venueId)
    .single();

  if (venueError || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  if (venue.onboarding_status !== 'active') {
    return NextResponse.json(
      { error: 'Payment processor onboarding is not complete' },
      { status: 400 }
    );
  }

  if (!venue.ghl_connected) {
    return NextResponse.json(
      { error: 'Messaging is not connected' },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from('venues')
    .update({ setup_completed: true })
    .eq('id', venueId);

  if (updateError) {
    return NextResponse.json({ error: 'Failed to complete setup' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
