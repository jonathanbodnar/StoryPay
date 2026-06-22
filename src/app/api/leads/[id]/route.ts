import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { legacyStatusForStageName } from '@/lib/pipelines';
import { leadRowWithTags, setLeadTagIds } from '@/lib/lead-tags';
import { onMarketingStageChanged, onMarketingTagAdded } from '@/lib/marketing-email-worker';
import { dispatchIntegrationEvent } from '@/lib/integration-events';
import { syncVenueCustomerFromLeadRow } from '@/lib/venue-customer-pipeline-sync';
import { getSessionUser } from '@/lib/session';
import { insertLeadActivity } from '@/lib/lead-activity';
import { fetchOpenDuplicateMatchesForLeads, refreshDuplicateCandidatesForLead } from '@/lib/lead-duplicates';
import { broadcastStageChanged, broadcastTagsChanged } from '@/lib/realtime/broadcast';
import { findMatchingLeadIds, findMatchingVenueCustomerIds } from '@/lib/find-matching-leads';
import { applyAiStateFromTagAdds } from '@/lib/ai-concierge/state-control';

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

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;

  const { data: leadRow, error } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error) {
    console.error('[GET /api/leads/[id]] failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!leadRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const dupMap = await fetchOpenDuplicateMatchesForLeads(venueId, [id]);
  const withTags = await leadRowWithTags(venueId, leadRow as Record<string, unknown>);
  return NextResponse.json({
    lead: { ...withTags, duplicate_matches: dupMap.get(id) ?? [] },
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
    guestCount?: number | string | null;
    bookingTimeline?: string | null;
    venueMatters?: string | null;
    message?: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
    position?: number;
    /** Full replacement of tag ids for this lead. */
    tagIds?: string[];
    lostReason?: string | null;
    referralSource?: string | null;
    firstTouchUtm?: Record<string, unknown> | null;
    assignedMemberId?: string | null;
    /** When true, venue may send marketing email; also clears suppression list entry. */
    marketingEmailOptIn?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { data: prevSnap } = await supabaseAdmin
    .from('leads')
    .select('stage_id, opportunity_value, assigned_member_id')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  const previousStageId = (prevSnap?.stage_id as string | null) ?? null;
  const prevOpp = prevSnap?.opportunity_value;
  const prevAssign = (prevSnap?.assigned_member_id as string | null) ?? null;

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
  if (typeof body.venueMatters === 'string' || body.venueMatters === null) updates.venue_matters = body.venueMatters || null;
  if (typeof body.message === 'string' || body.message === null) updates.message = body.message;
  if (body.weddingDate === null || typeof body.weddingDate === 'string') updates.wedding_date = body.weddingDate || null;
  if (body.guestCount === null || typeof body.guestCount === 'number' || typeof body.guestCount === 'string') {
    if (body.guestCount === null || body.guestCount === '') updates.guest_count = null;
    else {
      const n = Number(String(body.guestCount).replace(/,/g, ''));
      if (!Number.isNaN(n)) updates.guest_count = n;
    }
  }
  if (body.opportunityValue === null || body.opportunityValue === '' || body.opportunityValue === undefined) {
    if (body.opportunityValue !== undefined) updates.opportunity_value = null;
  } else if (typeof body.opportunityValue === 'number' || typeof body.opportunityValue === 'string') {
    const n = Number(String(body.opportunityValue).replace(/,/g, ''));
    if (!Number.isNaN(n)) updates.opportunity_value = n;
  }
  if (body.pipelineId === null || typeof body.pipelineId === 'string') updates.pipeline_id = body.pipelineId || null;
  if (body.stageId === null || typeof body.stageId === 'string')       updates.stage_id    = body.stageId    || null;
  if (typeof body.position === 'number')           updates.position = body.position;
  if (body.lostReason === null || typeof body.lostReason === 'string') {
    updates.lost_reason = body.lostReason?.trim() || null;
  }
  if (body.referralSource === null || typeof body.referralSource === 'string') {
    updates.referral_source = body.referralSource?.trim() || null;
  }
  if (body.firstTouchUtm !== undefined) {
    updates.first_touch_utm =
      body.firstTouchUtm && typeof body.firstTouchUtm === 'object' ? body.firstTouchUtm : {};
  }

  if (typeof body.marketingEmailOptIn === 'boolean') {
    updates.marketing_email_opt_in = body.marketingEmailOptIn;
  }

  if (body.assignedMemberId !== undefined) {
    if (body.assignedMemberId === null || body.assignedMemberId === '') {
      updates.assigned_member_id = null;
    } else if (typeof body.assignedMemberId === 'string') {
      const { data: mem } = await supabaseAdmin
        .from('venue_team_members')
        .select('id')
        .eq('id', body.assignedMemberId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!mem) {
        return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 });
      }
      updates.assigned_member_id = body.assignedMemberId;
    }
  }

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

  if (typeof body.marketingEmailOptIn === 'boolean' && body.marketingEmailOptIn === true) {
    await supabaseAdmin
      .from('marketing_email_suppressions')
      .delete()
      .eq('venue_id', venueId)
      .eq('lead_id', id);
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

    if (updates.email !== undefined || updates.phone !== undefined) {
      await refreshDuplicateCandidatesForLead(venueId, id);
    }
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

  const dupMap = await fetchOpenDuplicateMatchesForLeads(venueId, [id]);
  const withTags = await leadRowWithTags(venueId, leadRow as Record<string, unknown>);
  const leadPayload = { ...withTags, duplicate_matches: dupMap.get(id) ?? [] };

  {
    const nextStageId = (leadRow.stage_id as string | null) ?? null;
    if (nextStageId !== previousStageId) {
      void onMarketingStageChanged(venueId, id, nextStageId);
    }
  }

  if (hasTagPatch) {
    const arr = Array.isArray(body.tagIds) ? body.tagIds.filter((x): x is string => typeof x === 'string') : [];
    const added = arr.filter((tid) => !previousTagIds.has(tid));
    if (added.length) {
      void onMarketingTagAdded(venueId, id, added);
      // If any of the newly-added tags is one of the reserved AI control
      // system tags (ai_active / ai_paused / ai_handoff), drive the lead's
      // ai_state through the canonical state-control path. This is what
      // lets an operator turn AI follow-ups on/off by simply tagging the
      // lead from the contact view.
      void applyAiStateFromTagAdds(id, venueId, added, 'venue_dashboard:tag');
      for (const tagId of added) {
        void dispatchIntegrationEvent(venueId, 'tag.added', {
          lead_id: id,
          tag: { id: tagId },
        });
      }
    }

    // Broadcast tags-changed to admin context sidebar so any open bride thread
    // tied to this lead's email/phone reflects the new applied tag set live.
    // Uses the shared matcher so format differences (e.g. phone "(555) 555-5555"
    // vs "+15555555555") still resolve to the same person.
    void (async () => {
      try {
        const leadEmail = (leadRow as { email?: string | null }).email ?? null;
        const leadPhone = (leadRow as { phone?: string | null }).phone ?? null;
        if (!leadEmail && !leadPhone) return;

        const [vcIds, leadIdSet] = await Promise.all([
          findMatchingVenueCustomerIds({ venueId, email: leadEmail, phone: leadPhone }),
          findMatchingLeadIds({ venueId, email: leadEmail, phone: leadPhone }),
        ]);
        if (vcIds.size === 0) return;
        leadIdSet.add(id);

        const { data: assigns } = await supabaseAdmin
          .from('lead_tag_assignments')
          .select('tag_id')
          .eq('venue_id', venueId)
          .in('lead_id', Array.from(leadIdSet));
        const dedup = new Set<string>();
        for (const a of (assigns ?? []) as Array<{ tag_id: string }>) dedup.add(a.tag_id);
        const appliedTagIds = Array.from(dedup);

        // Fan out to every conversation thread for any matching venue_customer
        const { data: threads } = await supabaseAdmin
          .from('conversation_threads')
          .select('id, venue_customer_id')
          .eq('venue_id', venueId)
          .in('venue_customer_id', Array.from(vcIds))
          .limit(50);
        for (const t of (threads ?? []) as Array<{ id: string; venue_customer_id: string }>) {
          void broadcastTagsChanged({
            threadId:    t.id,
            venueId,
            vcId:        t.venue_customer_id,
            appliedTagIds,
            source:      'venue',
          });
        }
      } catch (err) {
        console.warn('[leads PATCH] broadcastTagsChanged failed', err);
      }
    })();
  }

  const lr = leadRow as { email: string | null; pipeline_id: string | null; stage_id: string | null };
  if (lr.email && lr.pipeline_id && lr.stage_id) {
    void syncVenueCustomerFromLeadRow(venueId, {
      email: lr.email,
      pipeline_id: lr.pipeline_id,
      stage_id: lr.stage_id,
    });
  }

  // Broadcast stage change to admin support context sidebar + venue conversations
  // page so any open thread tied to this lead's email reflects the new stage live.
  if (body.stageId !== undefined && previousStageId !== ((leadRow.stage_id as string | null) ?? null)) {
    void (async () => {
      try {
        const stageId = (leadRow.stage_id as string | null) ?? null;
        if (!stageId || !lr.email) return;
        const { data: stageRow } = await supabaseAdmin
          .from('lead_pipeline_stages')
          .select('name, color, pipeline_id')
          .eq('id', stageId)
          .maybeSingle();
        const sr = stageRow as { name?: string; color?: string | null; pipeline_id?: string } | null;
        const { data: vcRows } = await supabaseAdmin
          .from('venue_customers')
          .select('id')
          .eq('venue_id', venueId)
          .ilike('customer_email', lr.email);
        const vcIds = (vcRows ?? []).map((r: { id: string }) => r.id);
        if (vcIds.length === 0) return;
        const { data: threads } = await supabaseAdmin
          .from('conversation_threads')
          .select('id, venue_customer_id')
          .eq('venue_id', venueId)
          .in('venue_customer_id', vcIds)
          .limit(50);
        for (const t of (threads ?? []) as Array<{ id: string; venue_customer_id: string }>) {
          void broadcastStageChanged({
            threadId:   t.id,
            venueId,
            vcId:       t.venue_customer_id,
            stageId,
            stageName:  sr?.name ?? '',
            stageColor: sr?.color ?? null,
            pipelineId: sr?.pipeline_id ?? (lr.pipeline_id ?? ''),
            source:     'venue',
          });
        }
      } catch {
        // best-effort
      }
    })();
  }

  if (Object.keys(updates).length > 0) {
    async function stageLabel(sid: string | null): Promise<string | null> {
      if (!sid) return null;
      const { data } = await supabaseAdmin
        .from('lead_pipeline_stages')
        .select('name')
        .eq('id', sid)
        .eq('venue_id', venueId)
        .maybeSingle();
      return (data?.name as string) ?? null;
    }

    const nextStage = (leadRow.stage_id as string | null) ?? null;
    const nextOpp = leadRow.opportunity_value;
    const nextAssign = (leadRow as { assigned_member_id?: string | null }).assigned_member_id ?? null;

    if (body.stageId !== undefined && previousStageId !== nextStage) {
      const [fromN, toN] = await Promise.all([stageLabel(previousStageId), stageLabel(nextStage)]);
      void insertLeadActivity({
        venueId,
        leadId: id,
        actorMemberId: user.memberId,
        actorIsOwner: !user.memberId,
        action: 'stage_changed',
        details: {
          from_stage_id: previousStageId,
          to_stage_id: nextStage,
          from_stage_name: fromN,
          to_stage_name: toN,
        },
      });
    }
    if (body.opportunityValue !== undefined && Number(prevOpp ?? 0) !== Number(nextOpp ?? 0)) {
      void insertLeadActivity({
        venueId,
        leadId: id,
        actorMemberId: user.memberId,
        actorIsOwner: !user.memberId,
        action: 'value_changed',
        details: { from: prevOpp, to: nextOpp },
      });
    }
    if (body.assignedMemberId !== undefined && prevAssign !== nextAssign) {
      void insertLeadActivity({
        venueId,
        leadId: id,
        actorMemberId: user.memberId,
        actorIsOwner: !user.memberId,
        action: 'assigned_changed',
        details: { from_member_id: prevAssign, to_member_id: nextAssign },
      });
    }
  }

  return NextResponse.json({ lead: leadPayload });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;

  // Fetch email + protected flag before deletion.
  const { data: lead, error: fetchErr } = await supabaseAdmin
    .from('leads')
    .select('id, email, is_protected')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[DELETE /api/leads/[id]] fetch failed:', fetchErr);
    return NextResponse.json({ error: `Delete failed: ${fetchErr.message}` }, { status: 500 });
  }
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  // Block deletion of protected demo contacts.
  if ((lead as { is_protected?: boolean }).is_protected) {
    return NextResponse.json(
      { error: 'This is a protected demo contact and cannot be deleted.' },
      { status: 403 },
    );
  }

  const { error } = await supabaseAdmin
    .from('leads')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) {
    console.error('[DELETE /api/leads/[id]] failed:', error);
    return NextResponse.json({ error: `Delete failed: ${error.message}` }, { status: 500 });
  }

  // Also remove the matching venue_customer row (same venue + same email).
  const email = (lead as { email?: string | null }).email;
  if (email) {
    await supabaseAdmin
      .from('venue_customers')
      .delete()
      .eq('venue_id', venueId)
      .eq('customer_email', email);
  }

  return NextResponse.json({ ok: true });
}
