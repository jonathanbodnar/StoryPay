import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureDefaultPipeline, legacyStatusForStageName } from '@/lib/pipelines';
import { reconcileLeadsForKanban } from '@/lib/leads-reconcile';
import { fetchTagsForLeadIds, leadRowWithTags, setLeadTagIds } from '@/lib/lead-tags';
import { fetchOpenDuplicateMatchesForLeads, recordDuplicateCandidatesForNewLead } from '@/lib/lead-duplicates';
import { applySystemTags, ensureSystemTagsForVenue } from '@/lib/system-tags';
import { dispatchIntegrationEvent } from '@/lib/integration-events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Supabase's default generics struggle with long `.or()` filter chains and
// infer a union that includes the error shape. Our rows are always this
// row type when the query succeeds, so we just assert it locally.
interface LeadRow {
  id: string;
  venue_id: string;
  track_token?: string;
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
  lost_reason?: string | null;
  referral_source?: string | null;
  first_touch_utm?: Record<string, unknown> | null;
  assigned_member_id?: string | null;
  marketing_email_opt_in?: boolean | null;
  space_id?: string | null;
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
  // new venues see an empty screen on their first visit. Reconcile is best-
  // effort: a transient DB error here shouldn't block the user from seeing
  // the leads that were already fine.
  let defaultPipelineId: string | null = null;
  try {
    defaultPipelineId = await ensureDefaultPipeline(venueId);
  } catch (err) {
    console.error('[GET /api/leads] ensureDefaultPipeline failed:', err);
  }
  try {
    await reconcileLeadsForKanban(venueId);
  } catch (err) {
    console.error('[GET /api/leads] reconcileLeadsForKanban failed:', err);
  }

  // Columns we always need. Listed in two groups so we can drop the optional
  // ones (which were added by later migrations) when the deployed DB is
  // missing them, instead of returning a 500 to the client.
  const REQUIRED_COLS = [
    'id', 'venue_id', 'first_name', 'last_name', 'name', 'email', 'phone',
    'status', 'source', 'created_at', 'updated_at', 'message', 'notes',
    'wedding_date', 'guest_count', 'booking_timeline',
  ];
  // OPTIONAL_COLS may not exist on older databases. We try the full list
  // first; if a `column ... does not exist` error comes back, we strip that
  // column from the list and retry. Keeps the kanban working through any
  // partially-migrated state.
  const OPTIONAL_COLS = [
    'track_token',
    'venue_name', 'venue_website_url', 'opportunity_value',
    'pipeline_id', 'stage_id', 'position',
    'lost_reason', 'referral_source', 'first_touch_utm',
    'assigned_member_id', 'marketing_email_opt_in',
    'excluded_from_pipeline', 'space_id',
    // Added by migration 068 — may be absent on older DBs
    'venue_matters',
  ];

  /**
   * Run a leads SELECT, progressively dropping optional columns or filters
   * that the deployed schema doesn't have.
   * Returns { rows, error, hasExclude } where hasExclude tells the caller
   * whether the excluded_from_pipeline filter could be applied.
   */
  async function runLeadsSelect(extraOpts: {
    applyOrFilters?: boolean;
    applySearch?: boolean;
  } = { applyOrFilters: true, applySearch: true }) {
    let optional = [...OPTIONAL_COLS];
    let useExcludeFilter = optional.includes('excluded_from_pipeline');
    // Bound the loop so a stuck schema can't infinite-loop us.
    for (let attempt = 0; attempt < 12; attempt++) {
      const cols = [...REQUIRED_COLS, ...optional].join(', ');
      let q1 = supabaseAdmin
        .from('leads')
        .select(cols)
        .eq('venue_id', venueId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(1000);

      if (extraOpts.applyOrFilters && useExcludeFilter) {
        q1 = q1.or('excluded_from_pipeline.is.null,excluded_from_pipeline.eq.false');
      }

      if (status)        q1 = q1.eq('status', status);
      if (pipelineId)    q1 = q1.eq('pipeline_id', pipelineId);
      if (stageId)       q1 = q1.eq('stage_id', stageId);
      if (createdAfter)  q1 = q1.gte('created_at', createdAfter);
      if (createdBefore) q1 = q1.lte('created_at', `${createdBefore}T23:59:59Z`);
      if (minValue)      q1 = q1.gte('opportunity_value', Number(minValue));
      if (maxValue)      q1 = q1.lte('opportunity_value', Number(maxValue));

      if (extraOpts.applySearch && q) {
        const pat = `%${q}%`;
        q1 = q1.or(
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

      const r = await q1;
      if (!r.error) return { rows: r.data, error: null, hasExclude: useExcludeFilter };

      // Identify which column the DB is complaining about and drop it.
      const m = /column "?([a-z_]+)"? .*does not exist|column .*\.([a-z_]+) does not exist/i.exec(r.error.message);
      const missing = (m?.[1] || m?.[2] || '').toLowerCase();
      if (missing) {
        if (missing === 'excluded_from_pipeline') {
          useExcludeFilter = false;
          optional = optional.filter((c) => c !== 'excluded_from_pipeline');
          continue;
        }
        if (optional.includes(missing)) {
          optional = optional.filter((c) => c !== missing);
          continue;
        }
      }
      // Unknown error or required column missing — give up.
      return { rows: null, error: r.error, hasExclude: useExcludeFilter };
    }
    return { rows: null, error: new Error('Could not load leads after 12 schema-fallback attempts'), hasExclude: false };
  }

  const main = await runLeadsSelect();
  if (main.error) {
    console.error('[GET /api/leads] failed:', main.error);
    return NextResponse.json({ error: `Failed to load leads: ${main.error.message}` }, { status: 500 });
  }
  const rows = main.rows;
  const hasExcludeFilter = main.hasExclude;

  const leadRows = (rows ?? []) as unknown as LeadRow[];

  // Safety net for the default-pipeline view: even if reconcile couldn't
  // move every lead (e.g. because it races with a concurrent write, or the
  // lead references a since-deleted pipeline), we don't want those leads to
  // silently vanish. Pull in any leads for this venue that are still
  // orphaned from a live pipeline and append them to the result so the user
  // can at least see the cards and drag them somewhere sensible.
  const isDefaultView = !!pipelineId && defaultPipelineId != null && pipelineId === defaultPipelineId;
  if (isDefaultView && !stageId && !status && !q && !createdAfter && !createdBefore && !minValue && !maxValue) {
    const { data: validPipelineRows } = await supabaseAdmin
      .from('lead_pipelines')
      .select('id')
      .eq('venue_id', venueId);
    const validPipelineIds = new Set<string>(
      ((validPipelineRows ?? []) as Array<{ id: string }>).map((p) => p.id),
    );

    // Only pull in leads whose pipeline_id points at a deleted pipeline —
    // leads with pipeline_id=NULL are intentionally "contact only" now (see
    // migration 051), so they must stay out of every kanban view.
    const orphanFilter = `pipeline_id.not.in.(${[...validPipelineIds].join(',') || '00000000-0000-0000-0000-000000000000'})`;

    // Use the same progressive-fallback strategy as the main query so a
    // partially-migrated DB can't make the orphan rescue blow up.
    let orphanOptional = [...OPTIONAL_COLS];
    let orphanUseExclude = orphanOptional.includes('excluded_from_pipeline') && hasExcludeFilter;
    let orphanRows: LeadRow[] | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const cols = [...REQUIRED_COLS, ...orphanOptional].join(', ');
      let oq = supabaseAdmin
        .from('leads')
        .select(cols)
        .eq('venue_id', venueId)
        .not('pipeline_id', 'is', null)
        .or(orphanFilter)
        .limit(500);
      if (orphanUseExclude) {
        oq = oq.or('excluded_from_pipeline.is.null,excluded_from_pipeline.eq.false');
      }
      const r = await oq;
      if (!r.error) {
        orphanRows = (r.data ?? null) as unknown as LeadRow[] | null;
        break;
      }
      const m = /column "?([a-z_]+)"? .*does not exist|column .*\.([a-z_]+) does not exist/i.exec(r.error.message);
      const missing = (m?.[1] || m?.[2] || '').toLowerCase();
      if (missing === 'excluded_from_pipeline') {
        orphanUseExclude = false;
        orphanOptional = orphanOptional.filter((c) => c !== 'excluded_from_pipeline');
        continue;
      }
      if (missing && orphanOptional.includes(missing)) {
        orphanOptional = orphanOptional.filter((c) => c !== missing);
        continue;
      }
      console.warn('[GET /api/leads] orphan rescue failed:', r.error.message);
      break;
    }
    const seenIds = new Set(leadRows.map((l) => l.id));
    for (const o of (orphanRows ?? []) as LeadRow[]) {
      if (seenIds.has(o.id)) continue;
      leadRows.push(o);
      seenIds.add(o.id);
    }
  }

  const leadIds = leadRows.map((l) => l.id);

  // Fire venue and notes queries in parallel.
  const venuePromise = supabaseAdmin
    .from('venues')
    .select('slug, name')
    .eq('id', venueId)
    .maybeSingle();

  let noteCounts: Record<string, number> = {};
  if (leadIds.length > 0) {
    const [{ data: notes }] = await Promise.all([
      supabaseAdmin.from('lead_notes').select('lead_id').in('lead_id', leadIds),
      venuePromise,
    ]);
    if (notes) {
      noteCounts = (notes as Array<{ lead_id: string }>).reduce<Record<string, number>>((acc, n) => {
        acc[n.lead_id] = (acc[n.lead_id] ?? 0) + 1;
        return acc;
      }, {});
    }
  }

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
      // Same progressive-fallback strategy used for the main query so this
      // can't blow up on partially-migrated databases either.
      let extraOptional = [...OPTIONAL_COLS];
      for (let attempt = 0; attempt < 12; attempt++) {
        const cols = [...REQUIRED_COLS, ...extraOptional].join(', ');
        const r = await supabaseAdmin
          .from('leads')
          .select(cols)
          .eq('venue_id', venueId)
          .in('id', missingNoteLeadIds);
        if (!r.error) {
          extraLeads = (r.data ?? []) as unknown as LeadRow[];
          break;
        }
        const m = /column "?([a-z_]+)"? .*does not exist|column .*\.([a-z_]+) does not exist/i.exec(r.error.message);
        const missing = (m?.[1] || m?.[2] || '').toLowerCase();
        if (missing && extraOptional.includes(missing)) {
          extraOptional = extraOptional.filter((c) => c !== missing);
          continue;
        }
        console.warn('[GET /api/leads] note-search rescue failed:', r.error.message);
        break;
      }
    }
  }

  const merged = [...leadRows, ...extraLeads];
  const seen = new Set<string>();
  const uniqueMerged = merged.filter((l) => {
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });

  const mergedIds = uniqueMerged.map((l) => l.id);

  const [
    { data: allStages },
    { data: calEvents },
    { data: venueData },
    tagMap,
    dupMap,
  ] = await Promise.all([
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
    venuePromise,
    fetchTagsForLeadIds(venueId, mergedIds),
    fetchOpenDuplicateMatchesForLeads(venueId, mergedIds),
  ]);
  const venue = venueData;

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

  // tagMap and dupMap already resolved above via Promise.all.

  const memberIds = [
    ...new Set(
      uniqueMerged
        .map((l) => (l as LeadRow).assigned_member_id)
        .filter((x): x is string => typeof x === 'string' && x.length > 0),
    ),
  ];
  const memberMap = new Map<string, { id: string; name: string; initials: string }>();
  if (memberIds.length > 0) {
    const { data: members } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, first_name, last_name, name')
      .eq('venue_id', venueId)
      .in('id', memberIds);
    for (const m of members ?? []) {
      const mm = m as { id: string; first_name: string | null; last_name: string | null; name: string | null };
      const name = [mm.first_name, mm.last_name].filter(Boolean).join(' ') || mm.name || 'Member';
      const initials = `${mm.first_name?.[0] ?? ''}${mm.last_name?.[0] ?? mm.name?.[0] ?? '?'}`.slice(0, 2).toUpperCase() || '?';
      memberMap.set(mm.id, { id: mm.id, name, initials });
    }
  }

  const leads = uniqueMerged.map((l) => {
    const aid = (l as LeadRow).assigned_member_id;
    return {
      ...l,
      listing_slug:  venue?.slug ?? null,
      listing_name:  venue?.name ?? null,
      note_count:    noteCounts[l.id] ?? 0,
      booking_badge: bookingBadge(l),
      tags:          tagMap.get(l.id) ?? [],
      assigned_member: aid ? memberMap.get(aid) ?? null : null,
      duplicate_matches: dupMap.get(l.id) ?? [],
    };
  });

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
    venueMatters?: string;
    pipelineId?: string;
    stageId?: string;
    spaceId?: string | null;
    tagIds?: string[];
    /**
     * When true, the lead is created without a pipeline/stage so it only
     * surfaces on the Contacts page and never in the Kanban. A mirror
     * venue_customers row is upserted so the contact is still searchable.
     */
    excludeFromPipeline?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const firstName = (body.firstName || '').trim();
  const lastName  = (body.lastName  || '').trim();
  const email     = (body.email     || '').trim();
  const phone     = (body.phone     || '').trim();
  const fullName  = (body.name      || `${firstName} ${lastName}`.trim()).trim();

  if (!firstName)  return NextResponse.json({ error: 'First name is required' }, { status: 400 });
  if (!lastName)   return NextResponse.json({ error: 'Last name is required' }, { status: 400 });
  if (!fullName)   return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!email)      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  if (!phone)      return NextResponse.json({ error: 'Phone is required' }, { status: 400 });

  // Intentionally skip pipeline assignment when the caller asked for a
  // contact-only record ("None" stage in the Add lead / Add contact modal).
  const excludeFromPipeline = body.excludeFromPipeline === true;

  // Figure out which pipeline/stage to drop the lead into (if any).
  let pipelineId: string | null = null;
  let stageId: string | undefined = undefined;
  let initialStatus = 'new';

  if (!excludeFromPipeline) {
    const defaultPipelineId = await ensureDefaultPipeline(venueId);
    pipelineId = body.pipelineId || defaultPipelineId;

    stageId = body.stageId;
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

    if (stageId) {
      const { data: stRow } = await supabaseAdmin
        .from('lead_pipeline_stages')
        .select('name')
        .eq('id', stageId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (stRow?.name) initialStatus = legacyStatusForStageName(stRow.name);
    }
  }

  const opportunityValue =
    body.opportunityValue === undefined || body.opportunityValue === '' || body.opportunityValue === null
      ? null
      : Number(body.opportunityValue);

  const spaceId = typeof body.spaceId === 'string' && body.spaceId.trim() ? body.spaceId.trim() : null;
  if (spaceId) {
    const { data: sp } = await supabaseAdmin
      .from('venue_spaces')
      .select('id')
      .eq('id', spaceId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!sp) return NextResponse.json({ error: 'Invalid space' }, { status: 400 });
  }

  const basePayload: Record<string, unknown> = {
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
    venue_matters:      body.venueMatters?.trim()    || null,
    message:            body.message || null,
    source:             'manual',
    status:             initialStatus,
    pipeline_id:        pipelineId,
    stage_id:           stageId ?? null,
    position:           0,
  };
  if (spaceId) basePayload.space_id = spaceId;
  if (excludeFromPipeline) basePayload.excluded_from_pipeline = true;

  let insert = await supabaseAdmin.from('leads').insert(basePayload).select('*').single();
  if (insert.error && spaceId && /column .*space_id/i.test(insert.error.message)) {
    // Migration 049 not applied yet — insert without the space so lead
    // creation still works, log a hint so the operator can apply it.
    console.warn('[POST /api/leads] leads.space_id column missing; dropping field (apply migration 049)');
    const { space_id: _omit, ...withoutSpace } = basePayload as Record<string, unknown> & { space_id?: string | null };
    void _omit;
    insert = await supabaseAdmin.from('leads').insert(withoutSpace).select('*').single();
  }
  if (insert.error && /column .*excluded_from_pipeline/i.test(insert.error.message)) {
    // Migration 051 not applied yet — fall back to the legacy path so the
    // lead is still created. Without the column the kanban reconciler will
    // push this lead into the default pipeline on the next fetch, but
    // that's still better than failing the whole request.
    console.warn('[POST /api/leads] leads.excluded_from_pipeline column missing; dropping field (apply migration 051)');
    const { excluded_from_pipeline: _omit, ...withoutFlag } = basePayload as Record<string, unknown> & { excluded_from_pipeline?: boolean };
    void _omit;
    insert = await supabaseAdmin.from('leads').insert(withoutFlag).select('*').single();
  }
  const { data, error } = insert;

  if (error) {
    console.error('[POST /api/leads] failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const newId = data.id as string;
  const row = data as LeadRow & { created_at?: string };
  await recordDuplicateCandidatesForNewLead(
    venueId,
    newId,
    email,
    body.phone?.trim() || null,
    String(row.created_at ?? new Date().toISOString()),
  );

  // Always mirror the new lead into venue_customers so the contact appears
  // on the Contacts page (which reads from venue_customers) regardless of
  // whether the lead has a pipeline stage or not.
  {
    const emailLower = email.toLowerCase();
    const { error: vcErr } = await supabaseAdmin
      .from('venue_customers')
      .upsert(
        {
          venue_id:       venueId,
          customer_email: emailLower,
          first_name:     firstName || null,
          last_name:      lastName || null,
          phone:          body.phone?.trim() || null,
          pipeline_id:    excludeFromPipeline ? null : (pipelineId ?? null),
          stage_id:       excludeFromPipeline ? null : (stageId ?? null),
          pipeline_stage: excludeFromPipeline ? null : initialStatus,
          updated_at:     new Date().toISOString(),
        },
        { onConflict: 'venue_id,customer_email' },
      );
    if (vcErr) {
      console.warn('[POST /api/leads] venue_customers upsert failed:', vcErr.message);
    }
  }

  if (Array.isArray(body.tagIds) && body.tagIds.length > 0) {
    await setLeadTagIds(
      venueId,
      newId,
      body.tagIds.filter((x): x is string => typeof x === 'string'),
    );
  }

  // Auto-apply system tags for new lead (fire-and-forget)
  ensureSystemTagsForVenue(venueId)
    .then(() => applySystemTags(venueId, newId, ['new_lead', 'inquiry_received', 'form_submitted']))
    .catch(() => {});

  // Fan out to Zapier / external integrations subscribed to lead.created
  void dispatchIntegrationEvent(venueId, 'lead.created', {
    lead: {
      id: newId,
      first_name: (data as LeadRow).first_name || '',
      last_name: (data as LeadRow).last_name || '',
      full_name: (data as LeadRow).name || '',
      email: (data as LeadRow).email,
      phone: (data as LeadRow).phone || '',
      wedding_date: (data as LeadRow).wedding_date,
      guest_count: (data as LeadRow).guest_count,
      booking_timeline: (data as LeadRow).booking_timeline,
      message: (data as LeadRow).message,
      status: (data as LeadRow).status,
      source: (data as LeadRow).source,
      created_at: (data as LeadRow).created_at,
    },
  });

  const dupMap = await fetchOpenDuplicateMatchesForLeads(venueId, [newId]);
  const withTags = await leadRowWithTags(venueId, data as Record<string, unknown>);
  return NextResponse.json({
    lead: { ...withTags, duplicate_matches: dupMap.get(newId) ?? [] },
  });
}
