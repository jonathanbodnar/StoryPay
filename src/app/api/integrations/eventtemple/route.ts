/**
 * Event Temple integration API — Settings → Integrations → Event Temple card.
 *
 * GET    → { connected, apiKey (masked), orgId, organizations[] }
 * POST   → { apiKey, orgId } — validates the credentials and saves them
 * DELETE → clears credentials (disconnect)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchEventTempleOrganizations } from '@/lib/eventtemple';

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
    .select('eventtemple_api_key, eventtemple_org_id')
    .eq('id', venueId)
    .maybeSingle();

  const v = venue as { eventtemple_api_key?: string | null; eventtemple_org_id?: string | null } | null;
  const apiKey = v?.eventtemple_api_key?.trim() || null;
  const orgId = v?.eventtemple_org_id?.trim() || null;

  if (!apiKey || !orgId) {
    return NextResponse.json({ connected: false, apiKey: null, orgId: null, organizations: [] });
  }

  // Fetch their organizations so the card can show which one leads land in.
  let organizations: Array<{ id: string; name: string }> = [];
  try {
    organizations = await fetchEventTempleOrganizations(apiKey, orgId);
  } catch {
    // Non-fatal — key may be stale; still report connected so the UI can show it.
  }

  return NextResponse.json({
    connected: true,
    apiKey: maskKey(apiKey),
    orgId,
    organizations,
  });
}

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { apiKey?: string; orgId?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : '';
  if (!apiKey) return NextResponse.json({ error: 'API key is required.' }, { status: 400 });
  if (!orgId) return NextResponse.json({ error: 'API-ORG identifier is required.' }, { status: 400 });

  // Validate by listing organizations — the cheapest authenticated call.
  let organizations: Array<{ id: string; name: string }> = [];
  try {
    organizations = await fetchEventTempleOrganizations(apiKey, orgId);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not verify your Event Temple credentials: ${e instanceof Error ? e.message : 'request failed'}` },
      { status: 400 },
    );
  }

  const { error: upErr } = await supabaseAdmin
    .from('venues')
    .update({ eventtemple_api_key: apiKey, eventtemple_org_id: orgId })
    .eq('id', venueId);

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ connected: true, organizations, orgId });
}

export async function DELETE() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await supabaseAdmin
    .from('venues')
    .update({ eventtemple_api_key: null, eventtemple_org_id: null })
    .eq('id', venueId);

  return NextResponse.json({ connected: false });
}
