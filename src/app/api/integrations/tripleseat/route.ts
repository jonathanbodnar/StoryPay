/**
 * Tripleseat integration API — Settings → Integrations → Tripleseat card.
 *
 * GET  → returns { connected, publicKey (masked), locationId, locations[] }
 * POST → { publicKey, locationId } — saves credentials + validates them
 * DELETE → clears credentials (disconnect)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchTripleseatLocations, pushLeadToTripleseat } from '@/lib/tripleseat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••••••' + key.slice(-4);
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('tripleseat_public_key, tripleseat_location_id')
    .eq('id', venueId)
    .maybeSingle();

  const v = venue as { tripleseat_public_key?: string | null; tripleseat_location_id?: number | null } | null;
  const publicKey = v?.tripleseat_public_key?.trim() || null;
  const locationId = v?.tripleseat_location_id ?? null;

  if (!publicKey) {
    return NextResponse.json({ connected: false, publicKey: null, locationId: null, locations: [] });
  }

  // Fetch their locations so the picker is always current.
  let locations: Array<{ id: number; name: string }> = [];
  try {
    locations = await fetchTripleseatLocations(publicKey);
  } catch {
    // Non-fatal — key may be stale; we still return connected=true so the UI
    // can show it and let them reconnect.
  }

  return NextResponse.json({
    connected: true,
    publicKey: maskKey(publicKey),
    locationId,
    locations,
  });
}

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { publicKey?: string; locationId?: number | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const publicKey = typeof body.publicKey === 'string' ? body.publicKey.trim() : '';
  if (!publicKey) return NextResponse.json({ error: 'Public API key is required.' }, { status: 400 });

  // Validate the key by fetching locations — this is the cheapest real API call.
  let locations: Array<{ id: number; name: string }> = [];
  try {
    locations = await fetchTripleseatLocations(publicKey);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not verify your Tripleseat key: ${e instanceof Error ? e.message : 'request failed'}` },
      { status: 400 },
    );
  }

  const locationId =
    typeof body.locationId === 'number' ? body.locationId :
    locations.length === 1 ? locations[0].id :
    null;

  const { error: upErr } = await supabaseAdmin
    .from('venues')
    .update({ tripleseat_public_key: publicKey, tripleseat_location_id: locationId })
    .eq('id', venueId);

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ connected: true, locations, locationId });
}

export async function DELETE() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await supabaseAdmin
    .from('venues')
    .update({ tripleseat_public_key: null, tripleseat_location_id: null })
    .eq('id', venueId);

  return NextResponse.json({ connected: false });
}

// PATCH — update just the selected location (after key is already saved)
export async function PATCH(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { locationId?: number | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { error } = await supabaseAdmin
    .from('venues')
    .update({ tripleseat_location_id: body.locationId ?? null })
    .eq('id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, locationId: body.locationId ?? null });
}

// POST /api/integrations/tripleseat/test — send a fake lead to verify end-to-end
export { testHandler as testPOST };
async function testHandler(venueId: string, publicKey: string, locationId: number | null) {
  const result = await pushLeadToTripleseat(publicKey, locationId, {
    first_name:        'Test',
    last_name:         'Lead',
    email_address:     'test@storyvenue.com',
    event_description: 'This is a test lead sent from StoryVenue to verify your Tripleseat integration.',
    email_opt_in:      false,
  });
  void venueId;
  return result;
}
