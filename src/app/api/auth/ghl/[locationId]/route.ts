import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { safeRedirect } from '@/lib/safe-redirect';

async function provisionVenue(locationId: string) {
  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .insert({
      name: 'New Venue',
      ghl_location_id: locationId,
      onboarding_status: 'not_started',
      setup_completed: false,
    })
    .select()
    .single();

  if (venueError || !venue) {
    throw new Error(`Failed to create venue: ${venueError?.message}`);
  }

  return venue;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ locationId: string }> }
) {
  const { locationId } = await params;

  try {
    const { data: existing } = await supabaseAdmin
      .from('venues')
      .select('id, setup_completed, onboarding_status')
      .eq('ghl_location_id', locationId)
      .single();

    const venue = existing ?? await provisionVenue(locationId);

    // Always go to the dashboard — StoryPay application is optional.
    // On first-ever login (setup not yet completed) pass ?welcome=1 so the
    // dashboard can pop open the StoryPay onboarding modal as a gentle prompt.
    const isFirstLogin = !venue.setup_completed;
    const destination = isFirstLogin ? '/dashboard?welcome=1' : '/dashboard';

    if (isFirstLogin) {
      await supabaseAdmin
        .from('venues')
        .update({ setup_completed: true })
        .eq('id', venue.id);
    }

    const response = safeRedirect(destination);

    response.cookies.set('venue_id', venue.id, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return safeRedirect(`/login/error?msg=${encodeURIComponent(msg)}`);
  }
}
