import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export async function POST() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabaseAdmin
    .from('venue_calendar_settings')
    .update({
      google_connected: false,
      google_account_email: null,
      google_access_token: null,
      google_refresh_token: null,
      google_token_expiry: null,
      google_linked_calendar_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also remove all conflict calendars (they were tied to the Google connection)
  await supabaseAdmin
    .from('venue_conflict_calendars')
    .delete()
    .eq('venue_id', venueId);

  return NextResponse.json({ success: true });
}
