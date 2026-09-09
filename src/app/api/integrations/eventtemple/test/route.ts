/**
 * POST /api/integrations/eventtemple/test
 * Sends a harmless test lead to Event Temple to verify the venue's API key +
 * org id are wired up correctly before real leads start flowing.
 */
import { NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { pushLeadToEventTemple } from '@/lib/eventtemple';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('eventtemple_api_key, eventtemple_org_id, eventtemple_stage_id')
    .eq('id', venueId)
    .maybeSingle();

  const v = venue as {
    eventtemple_api_key?: string | null;
    eventtemple_org_id?: string | null;
    eventtemple_stage_id?: string | null;
  } | null;
  if (!v?.eventtemple_api_key || !v?.eventtemple_org_id) {
    return NextResponse.json({ error: 'Event Temple is not connected.' }, { status: 400 });
  }

  const result = await pushLeadToEventTemple(
    v.eventtemple_api_key,
    v.eventtemple_org_id,
    {
      first_name: 'Test',
      last_name: 'Lead',
      email: 'test@storyvenue.com',
      message: 'This is a test lead sent from StoryVenue to verify your Event Temple integration is working correctly.',
    },
    v.eventtemple_stage_id ?? undefined,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Test lead failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, bookingId: result.bookingId });
}
