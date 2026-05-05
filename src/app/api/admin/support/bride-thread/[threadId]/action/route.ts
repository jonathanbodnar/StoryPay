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

  const email = (c.customer_email || '').trim().toLowerCase();
  if (email) {
    const { data: l } = await supabaseAdmin
      .from('leads')
      .select(baseFields)
      .eq('venue_id', t.venue_id)
      .eq('email', email)
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
      if (!lead) return NextResponse.json({ error: 'No lead linked to this thread yet' }, { status: 422 });
      if (!body.stageId) return NextResponse.json({ error: 'stageId required' }, { status: 400 });

      // Validate stage belongs to this venue
      const { data: stage } = await supabaseAdmin
        .from('lead_pipeline_stages')
        .select('id, name, pipeline_id, venue_id')
        .eq('id', body.stageId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!stage) return NextResponse.json({ error: 'Stage not found for this venue' }, { status: 404 });

      const s = stage as { id: string; name: string; pipeline_id: string };
      const { error: updErr } = await supabaseAdmin
        .from('leads')
        .update({
          stage_id:    s.id,
          pipeline_id: s.pipeline_id,
          updated_at:  new Date().toISOString(),
        })
        .eq('id', lead.id)
        .eq('venue_id', venueId);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

      // Mirror onto the venue_customer the thread is attached to. Many list
      // endpoints read stage from here as the canonical source.
      if (venueCustomerId) {
        await supabaseAdmin
          .from('venue_customers')
          .update({ stage_id: s.id })
          .eq('id', venueCustomerId)
          .eq('venue_id', venueId);
      }

      // Activity log (best-effort)
      void supabaseAdmin.from('lead_activity_log').insert({
        lead_id:  lead.id,
        venue_id: venueId,
        action:   'stage_changed_by_support',
        details:  { stage_id: s.id, stage_name: s.name, by: triggeredBy },
      }).then(() => {}, () => {});

      return NextResponse.json({ ok: true, stage: { id: s.id, name: s.name } });
    }

    case 'add_tag': {
      if (!lead) return NextResponse.json({ error: 'No lead linked to this thread yet' }, { status: 422 });
      if (!body.tagId) return NextResponse.json({ error: 'tagId required' }, { status: 400 });

      const { data: tag } = await supabaseAdmin
        .from('marketing_tags')
        .select('id, name, venue_id')
        .eq('id', body.tagId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (!tag) return NextResponse.json({ error: 'Tag not found for this venue' }, { status: 404 });

      const tg = tag as { id: string; name: string };
      const { error: insErr } = await supabaseAdmin
        .from('lead_tag_assignments')
        .upsert(
          { lead_id: lead.id, tag_id: tg.id, venue_id: venueId },
          { onConflict: 'lead_id,tag_id' },
        );
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

      void supabaseAdmin.from('lead_activity_log').insert({
        lead_id:  lead.id,
        venue_id: venueId,
        action:   'tag_added_by_support',
        details:  { tag_id: tg.id, tag_name: tg.name, by: triggeredBy },
      }).then(() => {}, () => {});

      return NextResponse.json({ ok: true, tag: { id: tg.id, name: tg.name } });
    }

    case 'remove_tag': {
      if (!lead) return NextResponse.json({ error: 'No lead linked to this thread yet' }, { status: 422 });
      if (!body.tagId) return NextResponse.json({ error: 'tagId required' }, { status: 400 });

      const { error: delErr } = await supabaseAdmin
        .from('lead_tag_assignments')
        .delete()
        .eq('lead_id', lead.id)
        .eq('tag_id', body.tagId)
        .eq('venue_id', venueId);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

      void supabaseAdmin.from('lead_activity_log').insert({
        lead_id:  lead.id,
        venue_id: venueId,
        action:   'tag_removed_by_support',
        details:  { tag_id: body.tagId, by: triggeredBy },
      }).then(() => {}, () => {});

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
