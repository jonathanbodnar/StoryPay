/**
 * POST /api/integrations/tripleseat/test
 * Sends a harmless test lead to Tripleseat to verify the venue's key + location
 * are wired up correctly before real leads start flowing.
 */
import { NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { pushLeadToTripleseat } from '@/lib/tripleseat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('tripleseat_public_key, tripleseat_location_id')
    .eq('id', venueId)
    .maybeSingle();

  const v = venue as { tripleseat_public_key?: string | null; tripleseat_location_id?: number | null } | null;
  if (!v?.tripleseat_public_key) {
    return NextResponse.json({ error: 'Tripleseat is not connected.' }, { status: 400 });
  }

  const result = await pushLeadToTripleseat(
    v.tripleseat_public_key,
    v.tripleseat_location_id ?? null,
    {
      first_name:        'Test',
      last_name:         'Lead',
      email_address:     'test@storyvenue.com',
      event_description: 'This is a test lead sent from StoryVenue to verify your Tripleseat integration is working correctly.',
      email_opt_in:      false,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Test lead failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, tripleseatLeadId: result.tripleseatLeadId });
}
