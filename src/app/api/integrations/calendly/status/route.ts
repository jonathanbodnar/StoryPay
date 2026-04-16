import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getCalendlyUser } from '@/lib/calendly';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('calendly_connected, calendly_access_token, calendly_user_uri, calendly_org_uri, calendly_webhook_id')
    .eq('id', venueId)
    .single();

  if (!venue?.calendly_connected || !venue.calendly_access_token) {
    return NextResponse.json({ connected: false });
  }

  // Verify the token is still valid
  try {
    const user = await getCalendlyUser(venue.calendly_access_token);
    return NextResponse.json({
      connected: true,
      user_name: user.name,
      user_email: user.email,
      webhook_registered: !!venue.calendly_webhook_id,
    });
  } catch {
    // Token is invalid — clear it
    await supabaseAdmin
      .from('venues')
      .update({ calendly_connected: false, calendly_access_token: null, calendly_webhook_id: null })
      .eq('id', venueId);
    return NextResponse.json({ connected: false, error: 'Token expired — please reconnect' });
  }
}
