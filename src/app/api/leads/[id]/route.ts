import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { legacyStatusForStageName } from '@/lib/pipelines';
import { leadRowWithTags, setLeadTagIds } from '@/lib/lead-tags';
import { onMarketingStageChanged, onMarketingTagAdded } from '@/lib/marketing-email-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Status values enforced by the DB CHECK constraint on `public.leads.status`.
 * We keep updating this alongside stage_id for backwards compatibility with
 * older inboxes that still use the enum.
 */
const ALLOWED_STATUSES = new Set([
  'new',
  'contacted',
  'tour_booked',
  'proposal_sent',
  'booked_wedding',
  'not_interested',
]);

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;

  let body: {
    status?: string;
    notes?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
    phone?: string;
    venueName?: string;
    venueWebsiteUrl?: string;
    opportunityValue?: number | string | null;
    weddingDate?: string | null;
    guestCount?: number | null;
    bookingTimeline?: string | null;
    message?: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
    position?: number;
    /** Full replacement of tag ids for this lead. */
    tagIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Allowed: ${[...ALLOWED_STATUSES].join(', ')}` },
        { status: 400 },
      );
    }
    updates.status = body.status;
  }
  if (typeof body.notes === 'string')              updates.notes = body.notes;
  if (typeof body.firstName === 'string')          updates.first_name = body.firstName.trim() || null;
  if (typeof body.lastName === 'string')           updates.last_name  = body.lastName.trim()  || null;
  if (typeof body.name === 'string')               updates.name = body.name.trim();
  if (typeof body.email === 'string')              updates.email = body.email.trim();
  if (typeof body.phone === 'string')              updates.phone = body.phone.trim();
  if (typeof body.venueName === 'string')          updates.venue_name = body.venueName.trim() || null;
  if (typeof body.venueWebsiteUrl === 'string')    updates.venue_website_url = body.venueWebsiteUrl.trim() || null;
  if (typeof body.bookingTimeline === 'string' || body.bookingTimeline === null) updates.booking_timeline = body.bookingTimeline || null;
  if (typeof body.message === 'string' || body.message === null) updates.message = body.message;
  if (body.weddingDate === null || typeof body.weddingDate === 'string') updates.wedding_date = body.weddingDate || null;
  if (body.guestCount === null || typeof body.guestCount === 'number') updates.guest_count = body.guestCount;
  if (body.opportunityValue === null || body.opportunityValue === '' || body.opportunityValue === undefined) {
    if (body.opportunityValue !== undefined) updates.opportunity_value = null;
  } else if (typeof body.opportunityValue === 'number' || typeof body.opportunityValue === 'string') {
    const n = Number(body.opportunityValue);
    if (!Number.isNaN(n)) updates.opportunity_value = n;
  }
  if (body.pipelineId === null || typeof body.pipelineId === 'string') updates.pipeline_id = body.pipelineId || null;
  if (body.stageId === null || typeof body.stageId === 'string')       updates.stage_id    = body.stageId    || null;
  if (typeof body.position === 'number')           updates.position = body.position;

  // When the stage changes (and the client didn't send an explicit status),
  // keep `leads.status` aligned with the stage name for legacy filters.
  if (typeof body.stageId === 'string' && body.stageId && typeof body.status !== 'string') {
    const { data: st } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('name')
      .eq('id', body.stageId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (st?.name) updates.status = legacyStatusForStageName(st.name);
  }

  // If the caller built a new first/last but didn't also send a full name,
  // keep the legacy `name` column in sync so old UIs still render correctly.
  if ((updates.first_name !== undefined || updates.last_name !== undefined) && updates.name === undefined) {
    const first = typeof updates.first_name === 'string' ? updates.first_name : body.firstName;
    const last  = typeof updates.last_name  === 'string' ? updates.last_name  : body.lastName;
    const rebuilt = `${first ?? ''} ${last ?? ''}`.trim();
    if (rebuilt) updates.name = rebuilt;
  }

  const hasTagPatch = body.tagIds !== undefined;

  let previousStageId: string | null | undefined;
  if (body.stageId !== undefined) {
    const { data: cur } = await supabaseAdmin
      .from('leads')
      .select('stage_id')
      .eq('id', id)
      .eq('venue_id', venueId)
      .maybeSingle();
    previousStageId = (cur?.stage_id as string | null) ?? null;
  }

  const previousTagIds = new Set<string>();
  if (hasTagPatch) {
    const { data: tagRows } = await supabaseAdmin
      .from('lead_tag_assignments')
      .select('tag_id')
      .eq('lead_id', id)
      .eq('venue_id', venueId);
    for (const r of tagRows ?? []) previousTagIds.add(String((r as { tag_id: string }).tag_id));
  }

  if (Object.keys(updates).length === 0 && !hasTagPatch) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  if (Object.keys(updates).length > 0) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .update(updates)
      .eq('id', id)
      .eq('venue_id', venueId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/leads/[id]] failed:', error);
      return NextResponse.json({ error: `Update failed: ${error.message}` }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  } else {
    const { data: exists, error: exErr } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('id', id)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (exErr) {
      return NextResponse.json({ error: exErr.message }, { status: 500 });
    }
    if (!exists) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  if (hasTagPatch) {
    const arr = Array.isArray(body.tagIds) ? body.tagIds.filter((x): x is string => typeof x === 'string') : [];
    await setLeadTagIds(venueId, id, arr);
  }

  const { data: leadRow, error: loadErr } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (loadErr || !leadRow) {
    return NextResponse.json({ error: loadErr?.message ?? 'Lead not found' }, { status: 500 });
  }

  const withTags = await leadRowWithTags(venueId, leadRow as Record<string, unknown>);

  if (body.stageId !== undefined && previousStageId !== undefined) {
    const nextStageId = (leadRow.stage_id as string | null) ?? null;
    if (nextStageId && nextStageId !== previousStageId) {
      void onMarketingStageChanged(venueId, id, nextStageId);
    }
  }

  if (hasTagPatch) {
    const arr = Array.isArray(body.tagIds) ? body.tagIds.filter((x): x is string => typeof x === 'string') : [];
    const added = arr.filter((tid) => !previousTagIds.has(tid));
    if (added.length) void onMarketingTagAdded(venueId, id, added);
  }

  return NextResponse.json({ lead: withTags });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;

  const { data, error } = await supabaseAdmin
    .from('leads')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[DELETE /api/leads/[id]] failed:', error);
    return NextResponse.json({ error: `Delete failed: ${error.message}` }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
