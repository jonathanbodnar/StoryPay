/**
 * POST /api/admin/support/bride-thread/[threadId]/action
 *
 * One-click pipeline / tag / AI updates from the admin support inbox so a
 * support agent can move the funnel forward without flipping tabs.
 *
 * Request body:
 *   { action: 'set_stage',     stageId: string }
 *   { action: 'add_tag',       tagId:   string }
 *   { action: 'remove_tag',    tagId:   string }
 *   { action: 're_enable_ai' }
 *   { action: 'pause_ai' }
 *
 * Auth: super admin OR support agent.
 *
 * For all actions we resolve the *lead* attached to the thread (best-effort
 * email/phone match, same heuristic as bride-context). If we can't find a
 * lead and the action requires one, we return 422.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { applyAiTag, removeAiTag } from '@/lib/ai-concierge/pipeline-tag-service';
import { ensureVenueAiResources } from '@/lib/ai-concierge/venue-resources';
import { recordAiStateTransition } from '@/lib/ai-concierge/state-transitions';
import { broadcastStageChanged, broadcastTagsChanged } from '@/lib/realtime/broadcast';
import type { AiState } from '@/lib/ai-concierge/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ActionBody =
  | { action: 'set_stage';    stageId: string }
  | { action: 'add_tag';      tagId:   string }
  | { action: 'remove_tag';   tagId:   string }
  | { action: 're_enable_ai' }
  | { action: 'pause_ai' };

interface LeadRow {
  id:                        string;
  venue_id:                  string;
  ai_state:                  AiState;
  ai_first_activated_at:     string | null;
  ai_expires_at:             string | null;
  ai_attempt_count:          number | null;
  ai_re_enable_count:        number | null;
  sms_dnd:                   boolean | null;
  sms_dnd_source:            string | null;
}

/**
 * Compute the union of currently-applied tag ids across every lead that
 * matches this venue_customer's email or phone, then broadcast a
 * tags_changed event to the active thread + venue thread channels so the
 * support sidebar (and venue-side conversations page) update without a
 * refresh. Best-effort — failures are logged but never thrown.
 */
async function fanoutTagsChanged(
  threadId: string,
  venueId: string,
  venueCustomerId: string,
  source: 'support' | 'venue',
): Promise<void> {
  try {
    const { data: vc } = await supabaseAdmin
      .from('venue_customers')
      .select('customer_email, phone')
      .eq('id', venueCustomerId)
      .maybeSingle();
    const c = vc as { customer_email: string | null; phone: string | null } | null;
    const email = (c?.customer_email || '').trim().toLowerCase();
    const phone = (c?.phone || '').trim();
    const leadIds = new Set<string>();
    if (email) {
      const { data } = await supabaseAdmin
        .from('leads').select('id')
        .eq('venue_id', venueId)
        .ilike('email', email);
      for (const r of (data ?? []) as Array<{ id: string }>) leadIds.add(r.id);
    }
    if (phone) {
      const { data } = await supabaseAdmin
        .from('leads').select('id')
        .eq('venue_id', venueId)
        .eq('phone', phone);
      for (const r of (data ?? []) as Array<{ id: string }>) leadIds.add(r.id);
    }
    let appliedTagIds: string[] = [];
    if (leadIds.size > 0) {
      const { data: assigns } = await supabaseAdmin
        .from('lead_tag_assignments')
        .select('tag_id')
        .eq('venue_id', venueId)
        .in('lead_id', Array.from(leadIds));
      const dedup = new Set<string>();
      for (const a of (assigns ?? []) as Array<{ tag_id: string }>) dedup.add(a.tag_id);
      appliedTagIds = Array.from(dedup);
    }
    void broadcastTagsChanged({
      threadId, venueId, vcId: venueCustomerId, appliedTagIds, source,
    });
  } catch (err) {
    console.warn('[fanoutTagsChanged] failed', err);
  }
}

/**
 * Ensure a `leads` row exists for a venue_customer. Used by support actions
 * (tag, etc.) that need a lead_id to operate on. Returns the lead id, or null
 * if we have nothing to identify the contact with (no email, phone, or name).
 */
async function ensureLeadForVenueCustomer(
  venueId: string,
  venueCustomerId: string,
): Promise<string | null> {
  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('first_name, last_name, customer_email, phone, stage_id, pipeline_id')
    .eq('id', venueCustomerId)
    .eq('venue_id', venueId)
    .maybeSingle();
  const c = vc as {
    first_name: string | null;
    last_name: string | null;
    customer_email: string | null;
    phone: string | null;
    stage_id: string | null;
    pipeline_id: string | null;
  } | null;
  if (!c) return null;

  const email = (c.customer_email || '').trim().toLowerCase();
  const phone = (c.phone || '').trim();
  const fn    = (c.first_name || '').trim();
  const ln    = (c.last_name || '').trim();

  // Try to find an existing lead first by email or phone
  if (email) {
    const { data: byEmail } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('venue_id', venueId)
      .ilike('email', email)
      .limit(1);
    if (byEmail?.[0]) return (byEmail[0] as { id: string }).id;
  }
  if (phone) {
    const { data: byPhone } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('venue_id', venueId)
      .eq('phone', phone)
      .limit(1);
    if (byPhone?.[0]) return (byPhone[0] as { id: string }).id;
  }

  const name = [fn, ln].filter(Boolean).join(' ') || email || phone || null;
  if (!name) return null;

  const now = new Date().toISOString();
  const { data: inserted, error } = await supabaseAdmin
    .from('leads')
    .insert({
      venue_id:    venueId,
      name,
      first_name:  fn || null,
      last_name:   ln || null,
      email:       email || null,
      phone:       phone || null,
      source:      'contact',
      status:      'new',
      pipeline_id: c.pipeline_id,
      stage_id:    c.stage_id,
      position:    0,
      updated_at:  now,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    console.error('[ensureLeadForVenueCustomer]', error);
    return null;
  }
  return (inserted as { id: string }).id;
}

async function resolveLeadForThread(
  threadId: string,
): Promise<{ lead: LeadRow | null; venueId: string | null; venueCustomerId: string | null; threadOk: boolean }> {
  const { data: thread } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, venue_customer_id')
    .eq('id', threadId)
    .maybeSingle();
  if (!thread) return { lead: null, venueId: null, venueCustomerId: null, threadOk: false };
  const t = thread as { venue_id: string; venue_customer_id: string };

  const { data: customer } = await supabaseAdmin
    .from('venue_customers')
    .select('customer_email, phone')
    .eq('id', t.venue_customer_id)
    .maybeSingle();
  const c = customer as { customer_email: string | null; phone: string | null } | null;
  if (!c) return { lead: null, venueId: t.venue_id, venueCustomerId: t.venue_customer_id, threadOk: true };

  const baseFields =
    'id, venue_id, ai_state, ai_first_activated_at, ai_expires_at, ai_attempt_count, ai_re_enable_count, sms_dnd, sms_dnd_source';

  // Use ilike() for email so mixed-case stored values still match. Same fix
  // we made in /bride-context — keep the two paths consistent so admin
  // actions and the displayed sidebar always point at the same lead.
  const email = (c.customer_email || '').trim().toLowerCase();
  if (email) {
    const { data: l } = await supabaseAdmin
      .from('leads')
      .select(baseFields)
      .eq('venue_id', t.venue_id)
      .ilike('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (l) return { lead: l as LeadRow, venueId: t.venue_id, venueCustomerId: t.venue_customer_id, threadOk: true };
  }
  if (c.phone) {
    const { data: l } = await supabaseAdmin
      .from('leads')
      .select(baseFields)
      .eq('venue_id', t.venue_id)
      .eq('phone', c.phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (l) return { lead: l as LeadRow, venueId: t.venue_id, venueCustomerId: t.venue_customer_id, threadOk: true };
  }
  return { lead: null, venueId: t.venue_id, venueCustomerId: t.venue_customer_id, threadOk: true };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ threadId: string }> }) {
  const auth = await verifySupportAccess();
  if (!auth.isSuperAdmin && !auth.agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { threadId } = await ctx.params;
  if (!threadId) return NextResponse.json({ error: 'Missing threadId' }, { status: 400 });

  let body: ActionBody;
  try { body = (await req.json()) as ActionBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { lead, venueId, venueCustomerId, threadOk } = await resolveLeadForThread(threadId);
  if (!threadOk) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  if (!venueId) return NextResponse.json({ error: 'Venue not resolved' }, { status: 404 });

  const triggeredBy = auth.agent
    ? `support:${auth.agent.sub}`
    : 'support:super_admin';

  switch (body.action) {
    case 'set_stage': {
      // Stage is canonical on venue_customers — leads is a best-effort mirror.
      // We allow updates even without a lead so support agents can move
      // venue-initiated conversations through the funnel just like the venue can.
      if (!body.stageId) return NextResponse.json({ error: 'stageId required' }, { status: 400 });
      if (!venueCustomerId) return NextResponse.json({ error: 'No contact linked to this thread' }, { status: 422 });

      // Validate stage belongs to this venue
      const { data: stage } = await supabaseAdmin
        .from('lead_pipeline_stages')
        .select('id, name, pipeline_id, venue_id, color')
        .eq('id', body.stageId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!stage) return NextResponse.json({ error: 'Stage not found for this venue' }, { status: 404 });

      const s = stage as { id: string; name: string; pipeline_id: string };

      // Mirror onto the venue_customer the thread is attached to (canonical
      // source for chat threads). This always succeeds even if no lead is
      // linked, so an admin can stage any conversation.
      const { error: vcErr } = await supabaseAdmin
        .from('venue_customers')
        .update({
          stage_id:    s.id,
          pipeline_id: s.pipeline_id,
          updated_at:  new Date().toISOString(),
        })
        .eq('id', venueCustomerId)
        .eq('venue_id', venueId);
      if (vcErr) {
        console.error('[support set_stage] venue_customers update failed', vcErr);
        return NextResponse.json({ error: vcErr.message }, { status: 500 });
      }

      // Mirror onto every lead that shares this venue_customer's email/phone.
      // Duplicates exist for some venues (multiple leads with the same email),
      // so we update them all instead of relying on the single lead we matched.
      const { data: vcRow } = await supabaseAdmin
        .from('venue_customers')
        .select('customer_email, phone')
        .eq('id', venueCustomerId)
        .maybeSingle();
      const vcr = vcRow as { customer_email: string | null; phone: string | null } | null;
      const vcEmail = (vcr?.customer_email || '').trim().toLowerCase();
      const vcPhone = (vcr?.phone || '').trim();
      const leadIdsToUpdate = new Set<string>();
      if (lead?.id) leadIdsToUpdate.add(lead.id);
      if (vcEmail) {
        const { data: ls } = await supabaseAdmin
          .from('leads')
          .select('id')
          .eq('venue_id', venueId)
          .ilike('email', vcEmail);
        for (const l of (ls ?? []) as Array<{ id: string }>) leadIdsToUpdate.add(l.id);
      }
      if (vcPhone) {
        const { data: ls } = await supabaseAdmin
          .from('leads')
          .select('id')
          .eq('venue_id', venueId)
          .eq('phone', vcPhone);
        for (const l of (ls ?? []) as Array<{ id: string }>) leadIdsToUpdate.add(l.id);
      }
      if (leadIdsToUpdate.size > 0) {
        const ids = Array.from(leadIdsToUpdate);
        const { error: leadsErr } = await supabaseAdmin
          .from('leads')
          .update({
            stage_id:    s.id,
            pipeline_id: s.pipeline_id,
            updated_at:  new Date().toISOString(),
          })
          .in('id', ids)
          .eq('venue_id', venueId);
        if (leadsErr) {
          console.error('[support set_stage] leads update failed', leadsErr);
          // non-fatal: stage already saved on venue_customer
        }
      }

      // Activity log (best-effort)
      if (lead) {
        void supabaseAdmin.from('lead_activity_log').insert({
          lead_id:  lead.id,
          venue_id: venueId,
          action:   'stage_changed_by_support',
          details:  { stage_id: s.id, stage_name: s.name, by: triggeredBy },
        }).then(() => {}, () => {});
      }

      // Broadcast so venue conversations page and support context sidebar both update live
      void broadcastStageChanged({
        threadId:   threadId,
        venueId:    venueId,
        vcId:       venueCustomerId ?? '',
        stageId:    s.id,
        stageName:  s.name,
        stageColor: (stage as { color?: string | null }).color ?? null,
        pipelineId: s.pipeline_id,
        source:     'support',
      });

      return NextResponse.json({ ok: true, stage: { id: s.id, name: s.name } });
    }

    case 'add_tag': {
      if (!body.tagId) return NextResponse.json({ error: 'tagId required' }, { status: 400 });
      if (!venueCustomerId) return NextResponse.json({ error: 'No contact linked to this thread' }, { status: 422 });

      const { data: tag } = await supabaseAdmin
        .from('marketing_tags')
        .select('id, name, venue_id')
        .eq('id', body.tagId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!tag) return NextResponse.json({ error: 'Tag not found for this venue' }, { status: 404 });

      // Auto-create a lead from the venue_customer if one doesn't exist yet,
      // since lead_tag_assignments requires a lead_id.
      let leadId: string | undefined = lead?.id;
      if (!leadId) {
        const created = await ensureLeadForVenueCustomer(venueId, venueCustomerId);
        if (!created) {
          return NextResponse.json({ error: 'Could not create a lead for this contact yet, needs at least a name, email, or phone.' }, { status: 422 });
        }
        leadId = created;
      }

      const tg = tag as { id: string; name: string };
      const { error: insErr } = await supabaseAdmin
        .from('lead_tag_assignments')
        .upsert(
          { lead_id: leadId, tag_id: tg.id, venue_id: venueId },
          { onConflict: 'lead_id,tag_id' },
        );
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

      void supabaseAdmin.from('lead_activity_log').insert({
        lead_id:  leadId,
        venue_id: venueId,
        action:   'tag_added_by_support',
        details:  { tag_id: tg.id, tag_name: tg.name, by: triggeredBy },
      }).then(() => {}, () => {});

      if (venueCustomerId) {
        void fanoutTagsChanged(threadId, venueId, venueCustomerId, 'support');
      }

      return NextResponse.json({ ok: true, tag: { id: tg.id, name: tg.name } });
    }

    case 'remove_tag': {
      if (!body.tagId) return NextResponse.json({ error: 'tagId required' }, { status: 400 });

      // Remove the tag from EVERY lead that matches this venue_customer's
      // email/phone so duplicate-lead scenarios don't leave a stray copy.
      // We collect candidate lead ids the same way bride-context does.
      const candidateLeadIds = new Set<string>();
      if (lead?.id) candidateLeadIds.add(lead.id);
      if (venueCustomerId) {
        const { data: vc } = await supabaseAdmin
          .from('venue_customers')
          .select('customer_email, phone')
          .eq('id', venueCustomerId)
          .maybeSingle();
        const c = vc as { customer_email: string | null; phone: string | null } | null;
        const em = (c?.customer_email || '').trim().toLowerCase();
        const ph = (c?.phone || '').trim();
        if (em) {
          const { data } = await supabaseAdmin
            .from('leads').select('id')
            .eq('venue_id', venueId)
            .ilike('email', em);
          for (const r of (data ?? []) as Array<{ id: string }>) candidateLeadIds.add(r.id);
        }
        if (ph) {
          const { data } = await supabaseAdmin
            .from('leads').select('id')
            .eq('venue_id', venueId)
            .eq('phone', ph);
          for (const r of (data ?? []) as Array<{ id: string }>) candidateLeadIds.add(r.id);
        }
      }
      if (candidateLeadIds.size === 0) return NextResponse.json({ ok: true });

      const { error: delErr } = await supabaseAdmin
        .from('lead_tag_assignments')
        .delete()
        .in('lead_id', Array.from(candidateLeadIds))
        .eq('tag_id', body.tagId)
        .eq('venue_id', venueId);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

      if (lead?.id) {
        void supabaseAdmin.from('lead_activity_log').insert({
          lead_id:  lead.id,
          venue_id: venueId,
          action:   'tag_removed_by_support',
          details:  { tag_id: body.tagId, by: triggeredBy },
        }).then(() => {}, () => {});
      }

      if (venueCustomerId) {
        void fanoutTagsChanged(threadId, venueId, venueCustomerId, 'support');
      }

      return NextResponse.json({ ok: true });
    }

    case 're_enable_ai': {
      if (!lead) return NextResponse.json({ error: 'No lead linked to this thread yet' }, { status: 422 });

      const tcpa = lead.sms_dnd === true && /^(tcpa|inbound_stop)/i.test(lead.sms_dnd_source ?? '');
      const expired60d =
        lead.ai_first_activated_at !== null &&
        new Date(lead.ai_first_activated_at).getTime() + 60 * 24 * 60 * 60 * 1000 <= Date.now();
      const stateAllows = ['paused', 'handoff', 'opted_out', 'exhausted'].includes(lead.ai_state);
      const blockers: string[] = [];
      if (!stateAllows) blockers.push(`State is "${lead.ai_state}" — re-enable only after AI has stopped`);
      if (tcpa)         blockers.push('Lead opted out via SMS STOP — legally cannot reactivate');
      if (expired60d)   blockers.push('60-day follow-up window elapsed (hard cap)');
      if (blockers.length > 0) {
        return NextResponse.json({ error: 'Cannot re-enable AI', blockers }, { status: 422 });
      }

      const cooldownEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const fromState   = lead.ai_state;

      const { data: updated, error } = await supabaseAdmin
        .from('leads')
        .update({
          ai_state:           'dormant',
          ai_re_enabled_at:   new Date().toISOString(),
          ai_re_enable_count: (lead.ai_re_enable_count ?? 0) + 1,
          ai_next_send_at:    cooldownEnd.toISOString(),
          updated_at:         new Date().toISOString(),
        })
        .eq('id', lead.id)
        .eq('venue_id', venueId)
        .in('ai_state', ['paused', 'handoff', 'opted_out', 'exhausted'])
        .select('id')
        .maybeSingle();

      if (error || !updated) {
        return NextResponse.json({
          error: error?.message ?? 'Lead state changed before update — refresh and retry',
        }, { status: 409 });
      }

      await ensureVenueAiResources(venueId);
      await Promise.all([
        removeAiTag(venueId, lead.id, 'ai_not_interested'),
        removeAiTag(venueId, lead.id, 'ai_needs_human'),
        removeAiTag(venueId, lead.id, 'ai_exhausted'),
        removeAiTag(venueId, lead.id, 'ai_replied'),
      ]);

      await recordAiStateTransition({
        leadId:      lead.id,
        venueId:     venueId,
        fromState,
        toState:     'dormant',
        reason:      'manually_re_enabled',
        triggeredBy: triggeredBy,
        metadata: {
          cooldown_end:        cooldownEnd.toISOString(),
          re_enable_count_new: (lead.ai_re_enable_count ?? 0) + 1,
        },
      });

      return NextResponse.json({ ok: true, cooldown_end: cooldownEnd.toISOString() });
    }

    case 'pause_ai': {
      if (!lead) return NextResponse.json({ error: 'No lead linked to this thread yet' }, { status: 422 });
      if (lead.ai_state !== 'ai_active') {
        return NextResponse.json({
          error: `Cannot pause — lead state is "${lead.ai_state}", not "ai_active"`,
        }, { status: 422 });
      }
      const fromState = lead.ai_state;
      const { data: updated, error } = await supabaseAdmin
        .from('leads')
        .update({
          ai_state:        'paused',
          ai_next_send_at: null,
          updated_at:      new Date().toISOString(),
        })
        .eq('id', lead.id)
        .eq('venue_id', venueId)
        .eq('ai_state', 'ai_active')
        .select('id')
        .maybeSingle();
      if (error || !updated) {
        return NextResponse.json({
          error: error?.message ?? 'Lead is no longer in ai_active state',
        }, { status: 409 });
      }
      await ensureVenueAiResources(venueId);
      await Promise.all([
        removeAiTag(venueId, lead.id, 'ai_active'),
        applyAiTag(venueId, lead.id, 'ai_replied'),
      ]);
      await recordAiStateTransition({
        leadId:      lead.id,
        venueId:     venueId,
        fromState,
        toState:     'paused',
        reason:      'manually_paused',
        triggeredBy: triggeredBy,
        metadata:    { attempt_count: lead.ai_attempt_count ?? 0 },
      });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}
