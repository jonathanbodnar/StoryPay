import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureDefaultPipeline, legacyStatusForStageName } from '@/lib/pipelines';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Supabase's default generics struggle with long `.or()` filter chains and
// infer a union that includes the error shape. Our rows are always this
// row type when the query succeeds, so we just assert it locally.
interface LeadRow {
  id: string;
  venue_id: string;
  first_name: string | null;
  last_name: string | null;
  name: string;
  email: string;
  phone: string | null;
  wedding_date: string | null;
  guest_count: number | null;
  booking_timeline: string | null;
  message: string | null;
  notes: string | null;
  status: string;
  source: string;
  created_at: string;
  updated_at: string | null;
  venue_name: string | null;
  venue_website_url: string | null;
  opportunity_value: number | null;
  pipeline_id: string | null;
  stage_id: string | null;
  position: number;
}

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * GET /api/leads?status=<status>&pipeline_id=<id>&stage_id=<id>&q=<text>
 *                &created_after=YYYY-MM-DD&created_before=YYYY-MM-DD
 *                &min_value=<n>&max_value=<n>
 *
 * Returns leads for the current logged-in venue. Includes pipeline/stage
 * info and a per-lead note count so the Kanban cards can show a "3 notes"
 * badge without having to load every note up front.
 *
 * Search (`q`) is fuzzy-matched across: first/last name, legacy name, email,
 * phone, venue_name, venue_website_url, message, and notes.
 */
export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status        = searchParams.get('status');
  const pipelineId    = searchParams.get('pipeline_id');
  const stageId       = searchParams.get('stage_id');
  const q             = searchParams.get('q')?.trim() ?? '';
  const createdAfter  = searchParams.get('created_after');
  const createdBefore = searchParams.get('created_before');
  const minValue      = searchParams.get('min_value');
  const maxValue      = searchParams.get('max_value');

  // Make sure the default pipeline exists before we query leads — otherwise
  // new venues see an empty screen on their first visit.
  await ensureDefaultPipeline(venueId);

  let query = supabaseAdmin
    .from('leads')
    .select(
      'id, venue_id, first_name, last_name, name, email, phone, wedding_date, guest_count, ' +
      'booking_timeline, message, notes, status, source, created_at, updated_at, ' +
      'venue_name, venue_website_url, opportunity_value, pipeline_id, stage_id, position',
    )
    .eq('venue_id', venueId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(1000);

  if (status)     query = query.eq('status', status);
  if (pipelineId) query = query.eq('pipeline_id', pipelineId);
  if (stageId)    query = query.eq('stage_id', stageId);
  if (createdAfter)  query = query.gte('created_at', createdAfter);
  if (createdBefore) query = query.lte('created_at', `${createdBefore}T23:59:59Z`);
  if (minValue)   query = query.gte('opportunity_value', Number(minValue));
  if (maxValue)   query = query.lte('opportunity_value', Number(maxValue));

  if (q) {
    const pat = `%${q}%`;
    query = query.or(
      [
        `first_name.ilike.${pat}`,
        `last_name.ilike.${pat}`,
        `name.ilike.${pat}`,
        `email.ilike.${pat}`,
        `phone.ilike.${pat}`,
        `venue_name.ilike.${pat}`,
        `venue_website_url.ilike.${pat}`,
        `message.ilike.${pat}`,
        `notes.ilike.${pat}`,
      ].join(','),
    );
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error('[GET /api/leads] failed:', error);
    return NextResponse.json({ error: `Failed to load leads: ${error.message}` }, { status: 500 });
  }

  const leadRows = (rows ?? []) as unknown as LeadRow[];
  const leadIds = leadRows.map((l) => l.id);

  // Count notes per lead so the Kanban cards can show a "3 notes" badge.
  let noteCounts: Record<string, number> = {};
  if (leadIds.length > 0) {
    const { data: notes } = await supabaseAdmin
      .from('lead_notes')
      .select('lead_id')
      .in('lead_id', leadIds);
    if (notes) {
      noteCounts = (notes as Array<{ lead_id: string }>).reduce<Record<string, number>>((acc, n) => {
        acc[n.lead_id] = (acc[n.lead_id] ?? 0) + 1;
        return acc;
      }, {});
    }
  }

  // Venue slug/name for the list view's "from X listing" context line.
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('slug, name')
    .eq('id', venueId)
    .maybeSingle();

  // Also search across notes: if the query didn't match a lead column but does
  // match a lead_note.content row, include those leads as well. This keeps
  // search comprehensive (the user asked for "text conversation" search).
  let extraLeads: LeadRow[] = [];
  if (q && leadIds.length >= 0) {
    const { data: matchingNotes } = await supabaseAdmin
      .from('lead_notes')
      .select('lead_id, content')
      .eq('venue_id', venueId)
      .ilike('content', `%${q}%`)
      .limit(200);

    const foundIds = new Set(leadIds);
    const missingNoteLeadIds = ((matchingNotes ?? []) as Array<{ lead_id: string }>)
      .map((n) => n.lead_id)
      .filter((id) => !foundIds.has(id));

    if (missingNoteLeadIds.length > 0) {
      const { data: more } = await supabaseAdmin
        .from('leads')
        .select(
          'id, venue_id, first_name, last_name, name, email, phone, wedding_date, guest_count, ' +
          'booking_timeline, message, notes, status, source, created_at, updated_at, ' +
          'venue_name, venue_website_url, opportunity_value, pipeline_id, stage_id, position',
        )
        .eq('venue_id', venueId)
        .in('id', missingNoteLeadIds);
      extraLeads = (more ?? []) as unknown as LeadRow[];
    }
  }

  const merged = [...leadRows, ...extraLeads];
  const seen = new Set<string>();
  const uniqueMerged = merged.filter((l) => {
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });

  const [{ data: allStages }, { data: calEvents }] = await Promise.all([
    supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name, kind')
      .eq('venue_id', venueId),
    supabaseAdmin
      .from('calendar_events')
      .select('customer_email, start_at, event_type')
      .eq('venue_id', venueId)
      .neq('status', 'cancelled')
      .not('customer_email', 'is', null)
      .gte('start_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order('start_at', { ascending: true })
      .limit(500),
  ]);

  type StageMini = { name: string; kind: string };
  const stageById = new Map<string, StageMini>(
    ((allStages ?? []) as Array<{ id: string; name: string; kind: string }>).map((s) => [
      s.id,
      { name: s.name, kind: s.kind },
    ]),
  );

  const nextEventByEmail = new Map<string, { start_at: string; event_type: string }>();
  for (const ev of (calEvents ?? []) as Array<{ customer_email: string; start_at: string; event_type: string }>) {
    const key = (ev.customer_email || '').trim().toLowerCase();
    if (!key || nextEventByEmail.has(key)) continue;
    nextEventByEmail.set(key, { start_at: ev.start_at, event_type: ev.event_type });
  }

  function bookingBadge(l: LeadRow): { iso: string; variant: 'wedding' | 'appointment' } | null {
    const st = l.stage_id ? stageById.get(l.stage_id) : undefined;
    const won = st?.kind === 'won' || l.status === 'booked_wedding';
    const emailKey = (l.email || '').trim().toLowerCase();
    if (won) {
      if (l.wedding_date) return { iso: `${l.wedding_date}T12:00:00.000Z`, variant: 'wedding' };
      const ev = nextEventByEmail.get(emailKey);
      if (ev && (ev.event_type === 'wedding' || ev.event_type === 'reception')) {
        return { iso: ev.start_at, variant: 'wedding' };
      }
      return null;
    }
    const ev = nextEventByEmail.get(emailKey);
    if (ev) return { iso: ev.start_at, variant: 'appointment' };
    return null;
  }

  const leads = uniqueMerged.map((l) => ({
    ...l,
    listing_slug:  venue?.slug ?? null,
    listing_name:  venue?.name ?? null,
    note_count:    noteCounts[l.id] ?? 0,
    booking_badge: bookingBadge(l),
  }));

  return NextResponse.json({ leads });
}

/**
 * POST /api/leads
 *   body: { firstName?, lastName?, name?, email, phone?, venueName?,
 *           venueWebsiteUrl?, opportunityValue?, weddingDate?, guestCount?,
 *           message?, pipelineId?, stageId? }
 *
 * Create a lead by hand (the UI's "+ Add Lead" button). If the caller
 * doesn't specify a pipeline/stage, the lead is dropped into the default
 * pipeline's first stage.
 */
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
    phone?: string;
    venueName?: string;
    venueWebsiteUrl?: string;
    opportunityValue?: number | string;
    weddingDate?: string;
    guestCount?: number;
    message?: string;
    bookingTimeline?: string;
    pipelineId?: string;
    stageId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const firstName = (body.firstName || '').trim();
  const lastName  = (body.lastName  || '').trim();
  const email     = (body.email     || '').trim();
  const fullName  = (body.name      || `${firstName} ${lastName}`.trim()).trim();

  if (!fullName) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!email)    return NextResponse.json({ error: 'Email is required' }, { status: 400 });

  // Figure out which pipeline/stage to drop the lead into.
  const defaultPipelineId = await ensureDefaultPipeline(venueId);
  const pipelineId = body.pipelineId || defaultPipelineId;

  let stageId = body.stageId;
  if (!stageId) {
    const { data: firstStage } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id')
      .eq('pipeline_id', pipelineId)
      .eq('venue_id', venueId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    stageId = firstStage?.id;
  }

  let initialStatus = 'new';
  if (stageId) {
    const { data: stRow } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('name')
      .eq('id', stageId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (stRow?.name) initialStatus = legacyStatusForStageName(stRow.name);
  }

  const opportunityValue =
    body.opportunityValue === undefined || body.opportunityValue === '' || body.opportunityValue === null
      ? null
      : Number(body.opportunityValue);

  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert({
      venue_id:           venueId,
      name:               fullName,
      first_name:         firstName || null,
      last_name:          lastName  || null,
      email,
      phone:              body.phone || '',
      venue_name:         body.venueName || null,
      venue_website_url:  body.venueWebsiteUrl || null,
      opportunity_value:  opportunityValue,
      wedding_date:       body.weddingDate || null,
      guest_count:        body.guestCount ?? null,
      booking_timeline:   body.bookingTimeline?.trim() || null,
      message:            body.message || null,
      source:             'manual',
      status:             initialStatus,
      pipeline_id:        pipelineId,
      stage_id:           stageId ?? null,
      position:           0,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[POST /api/leads] failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lead: data });
}
