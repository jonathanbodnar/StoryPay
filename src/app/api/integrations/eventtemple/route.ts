/**
 * Event Temple integration API — Settings → Integrations → Event Temple card.
 *
 * GET    → { connected, apiKey (masked), orgId, organizations[], pipelines[], stages[], pipelineId, stageId }
 * POST   → { apiKey, orgId } — validates the credentials and saves them
 * PATCH  → { pipelineId, stageId } — save which pipeline/stage new leads land in
 * DELETE → clears credentials + pipeline/stage selection (disconnect)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import {
  fetchEventTempleOrganizations,
  fetchEventTemplePipelines,
  fetchEventTempleStages,
  fetchEventTempleReferralSources,
  fetchEventTempleBookingTypes,
  type EventTemplePipeline,
  type EventTempleStage,
  type EventTempleReferralSource,
  type EventTempleBookingType,
} from '@/lib/eventtemple';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••••••' + key.slice(-4);
}

type VenueETRow = {
  eventtemple_api_key?: string | null;
  eventtemple_org_id?: string | null;
  eventtemple_pipeline_id?: string | null;
  eventtemple_stage_id?: string | null;
  eventtemple_referral_source_id?: string | null;
  eventtemple_booking_type_id?: string | null;
};

const SELECT_COLS =
  'eventtemple_api_key, eventtemple_org_id, eventtemple_pipeline_id, eventtemple_stage_id, eventtemple_referral_source_id, eventtemple_booking_type_id';

/** Load routing options (pipelines, stages, referral sources, booking types), tolerating partial failures. */
async function loadRoutingOptions(apiKey: string, orgId: string): Promise<{
  pipelines: EventTemplePipeline[];
  stages: EventTempleStage[];
  referralSources: EventTempleReferralSource[];
  bookingTypes: EventTempleBookingType[];
}> {
  const [pipelines, stages, referralSources, bookingTypes] = await Promise.all([
    fetchEventTemplePipelines(apiKey, orgId).catch(() => [] as EventTemplePipeline[]),
    fetchEventTempleStages(apiKey, orgId).catch(() => [] as EventTempleStage[]),
    fetchEventTempleReferralSources(apiKey, orgId).catch(() => [] as EventTempleReferralSource[]),
    fetchEventTempleBookingTypes(apiKey, orgId).catch(() => [] as EventTempleBookingType[]),
  ]);
  return { pipelines, stages, referralSources, bookingTypes };
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select(SELECT_COLS)
    .eq('id', venueId)
    .maybeSingle();

  const v = venue as VenueETRow | null;
  const apiKey = v?.eventtemple_api_key?.trim() || null;
  const orgId = v?.eventtemple_org_id?.trim() || null;

  if (!apiKey || !orgId) {
    return NextResponse.json({
      connected: false, apiKey: null, orgId: null,
      organizations: [], pipelines: [], stages: [], referralSources: [], bookingTypes: [],
      pipelineId: null, stageId: null, referralSourceId: null, bookingTypeId: null,
    });
  }

  // Fetch org + routing options so the card can show them.
  let organizations: Array<{ id: string; name: string }> = [];
  try {
    organizations = await fetchEventTempleOrganizations(apiKey, orgId);
  } catch {
    // Non-fatal — key may be stale; still report connected so the UI can show it.
  }
  const { pipelines, stages, referralSources, bookingTypes } = await loadRoutingOptions(apiKey, orgId);

  return NextResponse.json({
    connected: true,
    apiKey: maskKey(apiKey),
    orgId,
    organizations,
    pipelines,
    stages,
    referralSources,
    bookingTypes,
    pipelineId: v?.eventtemple_pipeline_id ?? null,
    stageId: v?.eventtemple_stage_id ?? null,
    referralSourceId: v?.eventtemple_referral_source_id ?? null,
    bookingTypeId: v?.eventtemple_booking_type_id ?? null,
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

  const { pipelines, stages, referralSources, bookingTypes } = await loadRoutingOptions(apiKey, orgId);

  return NextResponse.json({
    connected: true, organizations, orgId, pipelines, stages, referralSources, bookingTypes,
    pipelineId: null, stageId: null, referralSourceId: null, bookingTypeId: null,
  });
}

export async function PATCH(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { pipelineId?: string | null; stageId?: string | null; referralSourceId?: string | null; bookingTypeId?: string | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Must be connected before choosing routing options.
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('eventtemple_api_key, eventtemple_org_id')
    .eq('id', venueId)
    .maybeSingle();
  const v = venue as VenueETRow | null;
  if (!v?.eventtemple_api_key || !v?.eventtemple_org_id) {
    return NextResponse.json({ error: 'Event Temple is not connected.' }, { status: 400 });
  }

  const norm = (x: unknown): string | null => {
    if (x == null) return null;
    const s = String(x).trim();
    return s ? s : null;
  };

  // Only update the keys actually present in the request so a partial save
  // (e.g. changing the referral source) never clobbers pipeline/stage.
  const patch: Record<string, string | null> = {};
  if ('pipelineId' in body)       patch.eventtemple_pipeline_id = norm(body.pipelineId);
  if ('stageId' in body)          patch.eventtemple_stage_id = norm(body.stageId);
  if ('referralSourceId' in body) patch.eventtemple_referral_source_id = norm(body.referralSourceId);
  if ('bookingTypeId' in body)    patch.eventtemple_booking_type_id = norm(body.bookingTypeId);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const { error: upErr } = await supabaseAdmin
    .from('venues')
    .update(patch)
    .eq('id', venueId);

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...patch });
}

export async function DELETE() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await supabaseAdmin
    .from('venues')
    .update({
      eventtemple_api_key: null,
      eventtemple_org_id: null,
      eventtemple_pipeline_id: null,
      eventtemple_stage_id: null,
      eventtemple_referral_source_id: null,
      eventtemple_booking_type_id: null,
    })
    .eq('id', venueId);

  return NextResponse.json({ connected: false });
}
