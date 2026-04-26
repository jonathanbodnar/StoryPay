import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureDefaultPipeline, legacyStatusForStageName } from '@/lib/pipelines';
import { reconcileLeadsForKanban } from '@/lib/leads-reconcile';
import { fetchTagsForLeadIds, leadRowWithTags, setLeadTagIds } from '@/lib/lead-tags';
import { fetchOpenDuplicateMatchesForLeads, recordDuplicateCandidatesForNewLead } from '@/lib/lead-duplicates';

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

  // `space_id` is added by migration 049 and might be missing on older DBs;
  // try with it first, fall back to the legacy column list on schema errors.
  const SELECT_WITH_SPACE =
    'id, venue_id, track_token, first_name, last_name, name, email, phone, wedding_date, guest_count, ' +
    'booking_timeline, message, notes, status, source, created_at, updated_at, ' +
    'venue_name, venue_website_url, opportunity_value, pipeline_id, stage_id, position, ' +
    'lost_reason, referral_source, first_touch_utm, assigned_member_id, marketing_email_opt_in, space_id';
  const SELECT_LEGACY =
    'id, venue_id, track_token, first_name, last_name, name, email, phone, wedding_date, guest_count, ' +
    'booking_timeline, message, notes, status, source, created_at, updated_at, ' +
    'venue_name, venue_website_url, opportunity_value, pipeline_id, stage_id, position, ' +
    'lost_reason, referral_source, first_touch_utm, assigned_member_id, marketing_email_opt_in';

  let query = supabaseAdmin
    .from('leads')
    .select(SELECT_WITH_SPACE)
    .eq('venue_id', venueId)
    // Contact-only leads (stage = "None") should never appear in the pipeline
    // list or kanban — they live only on the Contacts page.
    .or('excluded_from_pipeline.is.null,excluded_from_pipeline.eq.false')
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

  let { data: rows, error } = await query;
  if (error && /column .*excluded_from_pipeline/i.test(error.message)) {
    // Migration 051 not applied yet — drop the filter so the page still
    // works. Contact-only leads will show up in the kanban until the
    // migration runs, but nothing breaks.
    let q2 = supabaseAdmin
      .from('leads')
      .select(SELECT_WITH_SPACE)
      .eq('venue_id', venueId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(1000);
    if (status)     q2 = q2.eq('status', status);
    if (pipelineId) q2 = q2.eq('pipeline_id', pipelineId);
    if (stageId)    q2 = q2.eq('stage_id', stageId);
    const retry = await q2;
    rows = retry.data;
    error = retry.error;
  }
  if (error && /column .*space_id/i.test(error.message)) {
    // Migration 049 not applied yet — re-run with the legacy column list so
    // the leads page still works on pre-migration databases.
    const legacy = await supabaseAdmin
      .from('leads')
      .select(SELECT_LEGACY)
      .eq('venue_id', venueId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(1000);
    rows = legacy.data;
    error = legacy.error;
  }
  if (error) {
    console.error('[GET /api/leads] failed:', error);
    return NextResponse.json({ error: `Failed to load leads: ${error.message}` }, { status: 500 });
  }

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
    let orphanRows: LeadRow[] | null = null;
    const orphanFirst = await supabaseAdmin
      .from('leads')
      .select(SELECT_WITH_SPACE)
      .eq('venue_id', venueId)
      .or(`excluded_from_pipeline.is.null,excluded_from_pipeline.eq.false`)
      .not('pipeline_id', 'is', null)
      .or(orphanFilter)
      .limit(500);
    if (orphanFirst.error && /column .*excluded_from_pipeline/i.test(orphanFirst.error.message)) {
      const retry = await supabaseAdmin
        .from('leads')
        .select(SELECT_WITH_SPACE)
        .eq('venue_id', venueId)
        .not('pipeline_id', 'is', null)
        .or(orphanFilter)
        .limit(500);
      orphanRows = (retry.data ?? null) as unknown as LeadRow[] | null;
    } else if (orphanFirst.error && /column .*space_id/i.test(orphanFirst.error.message)) {
      const orphanLegacy = await supabaseAdmin
        .from('leads')
        .select(SELECT_LEGACY)
        .eq('venue_id', venueId)
        .not('pipeline_id', 'is', null)
        .or(orphanFilter)
        .limit(500);
      orphanRows = (orphanLegacy.data ?? null) as unknown as LeadRow[] | null;
    } else {
      orphanRows = (orphanFirst.data ?? null) as unknown as LeadRow[] | null;
    }
    const seenIds = new Set(leadRows.map((l) => l.id));
    for (const o of (orphanRows ?? []) as LeadRow[]) {
      if (seenIds.has(o.id)) continue;
      leadRows.push(o);
      seenIds.add(o.id);
    }
  }

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
      let more = await supabaseAdmin
        .from('leads')
        .select(SELECT_WITH_SPACE)
        .eq('venue_id', venueId)
        .in('id', missingNoteLeadIds);
      if (more.error && /column .*space_id/i.test(more.error.message)) {
        more = await supabaseAdmin
          .from('leads')
          .select(SELECT_LEGACY)
          .eq('venue_id', venueId)
          .in('id', missingNoteLeadIds);
      }
      extraLeads = (more.data ?? []) as unknown as LeadRow[];
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

  const tagMap = await fetchTagsForLeadIds(
    venueId,
    uniqueMerged.map((l) => l.id),
  );

  const dupMap = await fetchOpenDuplicateMatchesForLeads(venueId, uniqueMerged.map((l) => l.id));

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

  // Contact-only leads live on the Contacts page, which reads from
  // venue_customers. Upsert a mirror row so the new contact is searchable
  // there even though it has no pipeline/stage. (The kanban reconciler also
  // syncs contacts → leads in the other direction for regular leads.)
  if (excludeFromPipeline) {
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
          pipeline_id:    null,
          stage_id:       null,
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

  const dupMap = await fetchOpenDuplicateMatchesForLeads(venueId, [newId]);
  const withTags = await leadRowWithTags(venueId, data as Record<string, unknown>);
  return NextResponse.json({
    lead: { ...withTags, duplicate_matches: dupMap.get(newId) ?? [] },
  });
}
