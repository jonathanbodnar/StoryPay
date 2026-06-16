/**
 * GET /api/admin/support/bride-context/[threadId]
 *
 * Returns a unified payload of bride + venue context that the support sidebar
 * needs to display at-a-glance information without flipping tabs.
 *
 * The shape is *flat* and forgiving — every field is optional so the UI can
 * gracefully degrade when a piece of data isn't present (e.g. lead doesn't
 * exist yet for an inbound that hasn't been matched).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { findMatchingLeadIds } from '@/lib/find-matching-leads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const auth = await verifySupportAccess();
  if (!auth.isSuperAdmin && !auth.agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { threadId } = await params;

  // 1. Thread + venue + bride core
  const { data: thread } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, venue_customer_id, last_message_at, created_at')
    .eq('id', threadId)
    .maybeSingle();

  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

  const t = thread as { id: string; venue_id: string; venue_customer_id: string; last_message_at: string; created_at: string };

  const [{ data: venue, error: venueErr }, { data: customer, error: customerErr }] = await Promise.all([
    supabaseAdmin.from('venues')
      .select(`
        id, name, notification_email, timezone, created_at,
        directory_plan_id, directory_addon_concierge, directory_addon_verified, directory_addon_sponsored,
        a2p_verified, a2p_brand_status, a2p_campaign_status,
        ghl_connected,
        ai_concierge_enabled, ai_assistant_persona_name,
        ai_concierge_notify_emails
      `)
      .eq('id', t.venue_id).maybeSingle(),
    // Use * so a missing column never silently zeros stage_id/pipeline_id
    // out of the response (we read those fields below).
    supabaseAdmin.from('venue_customers')
      .select('*')
      .eq('id', t.venue_customer_id).maybeSingle(),
  ]);

  if (venueErr) console.error('[bride-context] venues select failed', { threadId, err: venueErr.message });
  if (customerErr) console.error('[bride-context] venue_customers select failed', { threadId, err: customerErr.message });

  // 2. Plan
  const v = venue as Record<string, unknown> | null;
  let plan: { id: string; name: string; price_cents: number; is_legacy: boolean } | null = null;
  if (v?.directory_plan_id) {
    const { data: planRow } = await supabaseAdmin
      .from('directory_plans')
      .select('id, name, price_cents, is_legacy')
      .eq('id', v.directory_plan_id as string)
      .maybeSingle();
    if (planRow) {
      const p = planRow as { id: string; name: string; price_cents: number; is_legacy: boolean };
      plan = p;
    }
  }

  // 3a. Sister venue_customers (same email/phone, same venue). When duplicates
  //     existed and were merged, the thread can still point at a row whose
  //     stage_id is null while another sister row holds the canonical stage.
  //     Collecting ALL of them means stage/tag resolution survives that.
  const c = customer as Record<string, unknown> | null;
  const allMatchingVcIds = new Set<string>();
  if (c?.id) allMatchingVcIds.add(c.id as string);
  let canonicalVc: Record<string, unknown> | null = c;
  if (c) {
    const vcEmail = ((c.customer_email as string) || '').trim().toLowerCase();
    const vcPhone = ((c.phone as string) || '').trim();
    if (vcEmail) {
      const { data: vcByEmail } = await supabaseAdmin
        .from('venue_customers')
        .select('*')
        .eq('venue_id', t.venue_id)
        .ilike('customer_email', vcEmail)
        .order('updated_at', { ascending: false });
      for (const row of (vcByEmail ?? []) as Array<Record<string, unknown>>) {
        allMatchingVcIds.add(row.id as string);
        if (row.stage_id && !(canonicalVc?.stage_id)) canonicalVc = row;
      }
    }
    if (vcPhone) {
      const { data: vcByPhone } = await supabaseAdmin
        .from('venue_customers')
        .select('*')
        .eq('venue_id', t.venue_id)
        .eq('phone', vcPhone)
        .order('updated_at', { ascending: false });
      for (const row of (vcByPhone ?? []) as Array<Record<string, unknown>>) {
        allMatchingVcIds.add(row.id as string);
        if (row.stage_id && !(canonicalVc?.stage_id)) canonicalVc = row;
      }
    }
  }

  // 3b. Leads — best-effort match (email and/or phone). Use case-insensitive
  //     matching so leads created via different code paths still link up. We
  //     collect ALL matching leads (not just the first) so tags from any
  //     duplicate also appear, and we still pick a single canonical lead for
  //     everything else (most recent).
  const LEAD_FIELDS = `
    id, first_name, last_name, email, phone, status, lead_source, created_at,
    ai_state, ai_first_activated_at, ai_expires_at, ai_next_send_at,
    ai_attempt_count, ai_re_enable_count, ai_re_enabled_at,
    last_inbound_at, last_outbound_at,
    stage_id, pipeline_id
  `;
  // Use the shared matcher (handles email + phone + last-10-digits fallback)
  // so a tag applied on the venue side always shows up here, even when the
  // bride's phone format differs between leads and venue_customers.
  const matchedIds = c
    ? await findMatchingLeadIds({
        venueId: t.venue_id,
        email:   c.customer_email as string | null,
        phone:   c.phone as string | null,
      })
    : new Set<string>();
  const allMatchingLeadIds = new Set<string>(matchedIds);
  let lead: Record<string, unknown> | null = null;
  if (allMatchingLeadIds.size > 0) {
    const { data: rows } = await supabaseAdmin
      .from('leads')
      .select(LEAD_FIELDS)
      .eq('venue_id', t.venue_id)
      .in('id', Array.from(allMatchingLeadIds))
      .order('created_at', { ascending: false });
    for (const l of (rows ?? []) as Array<Record<string, unknown>>) {
      // Prefer a lead with a stage; fall back to the most recent one
      if (!lead || (!lead.stage_id && l.stage_id)) lead = l;
    }
  }

  // 4. Pipeline stage. Prefer ANY sister venue_customer's stage_id (canonical
  //    source for chat threads — venue conversations + contacts pages write
  //    there). Fall back to a matched lead's stage_id. This survives the
  //    "thread linked to a customer row whose stage is null but a duplicate
  //    has it" scenario.
  let pipelineStage: { id: string; name: string; color: string | null; pipeline_id: string; pipeline_name: string } | null = null;
  const stageId =
    (canonicalVc?.stage_id as string | null) ||
    (c?.stage_id as string | null) ||
    (lead?.stage_id as string | null) ||
    null;
  if (stageId) {
    const { data: stage, error: stageErr } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name, color, pipeline_id, venue_id')
      .eq('id', stageId)
      .maybeSingle();
    if (stageErr) {
      console.error('[bride-context] stage lookup failed', { threadId, stageId, err: stageErr.message });
    }
    if (stage) {
      const s = stage as { id: string; name: string; color: string | null; pipeline_id: string };
      const { data: p } = await supabaseAdmin
        .from('lead_pipelines')
        .select('id, name')
        .eq('id', s.pipeline_id)
        .maybeSingle();
      pipelineStage = {
        id:           s.id,
        name:         s.name,
        color:        s.color,
        pipeline_id:  s.pipeline_id,
        pipeline_name: (p as { name?: string } | null)?.name ?? '',
      };
    } else {
      console.warn('[bride-context] no stage row for stageId', { threadId, stageId });
    }
  } else {
    console.warn('[bride-context] no stageId resolved', {
      threadId,
      vc_stage_id: c?.stage_id ?? null,
      lead_stage_id: lead?.stage_id ?? null,
      vc_id: t.venue_customer_id,
      vc_email: c?.customer_email ?? null,
      vc_phone: c?.phone ?? null,
      matching_leads: allMatchingLeadIds.size,
    });
  }

  // 5. Open ticket count
  const { count: openTicketsCount } = await supabaseAdmin
    .from('support_threads')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', t.venue_id)
    .in('status', ['open', 'pending']);

  // 6. Recent lead activities (last 5)
  let recentActivity: Array<{ action: string; at: string; details: unknown }> = [];
  if (lead?.id) {
    const { data: act } = await supabaseAdmin
      .from('lead_activity_log')
      .select('action, created_at, details')
      .eq('lead_id', lead.id as string)
      .order('created_at', { ascending: false })
      .limit(5);
    recentActivity = (act ?? []).map(a => {
      const r = a as { action: string; created_at: string; details: unknown };
      return { action: r.action, at: r.created_at, details: r.details };
    });
  }

  // 7. AI handoff banner — last ai_state_transitions row to/from 'handoff'
  let aiHandoff: { at: string; reason: string | null; trigger: string | null } | null = null;
  if (lead?.id) {
    const { data: trans } = await supabaseAdmin
      .from('ai_state_transitions')
      .select('to_state, reason, trigger_keyword, created_at')
      .eq('lead_id', lead.id as string)
      .eq('to_state', 'handoff')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (trans) {
      const tr = trans as { reason: string | null; trigger_keyword: string | null; created_at: string };
      aiHandoff = { at: tr.created_at, reason: tr.reason, trigger: tr.trigger_keyword };
    }
  }

  // 8. Total messages in this thread (informational)
  const { count: messageCount } = await supabaseAdmin
    .from('conversation_messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', threadId);

  // 9. Venue's pipelines + stages — feeds the inline stage picker
  const { data: pipelineRows } = await supabaseAdmin
    .from('lead_pipelines')
    .select('id, name, is_default, position')
    .eq('venue_id', t.venue_id)
    .order('position', { ascending: true });
  const pipelineIds = (pipelineRows ?? []).map(p => (p as { id: string }).id);
  let pipelinesWithStages: Array<{
    id:         string;
    name:       string;
    is_default: boolean;
    stages: Array<{ id: string; name: string; color: string | null; kind: string; position: number }>;
  }> = [];
  if (pipelineIds.length > 0) {
    const { data: stageRows } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, pipeline_id, name, color, kind, position')
      .eq('venue_id', t.venue_id)
      .in('pipeline_id', pipelineIds)
      .order('position', { ascending: true });
    const byPipeline = new Map<string, Array<{ id: string; name: string; color: string | null; kind: string; position: number }>>();
    for (const s of (stageRows ?? []) as Array<{ id: string; pipeline_id: string; name: string; color: string | null; kind: string; position: number }>) {
      const arr = byPipeline.get(s.pipeline_id) ?? [];
      arr.push({ id: s.id, name: s.name, color: s.color, kind: s.kind, position: s.position });
      byPipeline.set(s.pipeline_id, arr);
    }
    pipelinesWithStages = (pipelineRows ?? []).map(p => {
      const pp = p as { id: string; name: string; is_default: boolean };
      return { id: pp.id, name: pp.name, is_default: !!pp.is_default, stages: byPipeline.get(pp.id) ?? [] };
    });
  }

  // 10. Venue's tags + tags applied to this lead
  const { data: tagRows } = await supabaseAdmin
    .from('marketing_tags')
    .select('id, name, icon, color, position')
    .eq('venue_id', t.venue_id)
    .order('position', { ascending: true });
  const venueTags = ((tagRows ?? []) as Array<{ id: string; name: string; icon: string; color: string | null }>);

  // Pull tags from ALL matching leads (handles duplicate-lead scenarios where
  // the tag was applied to a different row than the one we picked as canonical).
  // We scope to venue_id as a defense-in-depth check, since lead_tag_assignments
  // has both lead_id and venue_id columns.
  const appliedTagIds: string[] = [];
  if (allMatchingLeadIds.size > 0) {
    const ids = Array.from(allMatchingLeadIds);
    const { data: assigns, error: tagErr } = await supabaseAdmin
      .from('lead_tag_assignments')
      .select('tag_id, lead_id')
      .eq('venue_id', t.venue_id)
      .in('lead_id', ids);
    if (tagErr) {
      console.error('[bride-context] lead_tag_assignments lookup failed', {
        threadId, lead_ids: ids, err: tagErr.message,
      });
    }
    const seen = new Set<string>();
    for (const a of (assigns ?? []) as Array<{ tag_id: string }>) {
      if (!seen.has(a.tag_id)) {
        seen.add(a.tag_id);
        appliedTagIds.push(a.tag_id);
      }
    }
    console.warn('[bride-context] tag lookup result', {
      threadId,
      lead_ids: ids,
      assigns_count: (assigns ?? []).length,
      tags_returned: appliedTagIds.length,
    });
  } else {
    console.warn('[bride-context] no matching leads for tags', {
      threadId,
      vc_id: t.venue_customer_id,
      vc_email: c?.customer_email ?? null,
      vc_phone: c?.phone ?? null,
    });
  }

  return NextResponse.json({
    bride: {
      first_name:    (c?.first_name as string | null) ?? null,
      last_name:     (c?.last_name as string | null) ?? null,
      email:         (c?.customer_email as string | null) ?? null,
      phone:         (c?.phone as string | null) ?? null,
      sms_dnd:       Boolean(c?.sms_dnd),
      conversation_dnd_all: Boolean(c?.conversation_dnd_all),
      submitted_at:  (lead?.created_at as string | null) ?? (c?.created_at as string | null) ?? null,
      lead_source:   (lead?.lead_source as string | null) ?? null,
      lead_status:   (lead?.status as string | null) ?? null,
      message_count: messageCount ?? 0,
    },
    thread: {
      id:              t.id,
      last_message_at: t.last_message_at,
      created_at:      t.created_at,
    },
    pipeline: pipelineStage,
    ai: lead ? {
      state:                 (lead.ai_state as string | null) ?? 'dormant',
      first_activated_at:    (lead.ai_first_activated_at as string | null) ?? null,
      expires_at:            (lead.ai_expires_at as string | null) ?? null,
      next_send_at:          (lead.ai_next_send_at as string | null) ?? null,
      attempt_count:         (lead.ai_attempt_count as number | null) ?? 0,
      re_enable_count:       (lead.ai_re_enable_count as number | null) ?? 0,
      last_inbound_at:       (lead.last_inbound_at as string | null) ?? null,
      last_outbound_at:      (lead.last_outbound_at as string | null) ?? null,
    } : null,
    ai_handoff: aiHandoff,
    venue: v ? {
      id:                  v.id as string,
      name:                v.name as string,
      notification_email:  (v.notification_email as string | null) ?? null,
      timezone:            (v.timezone as string | null) ?? null,
      created_at:          (v.created_at as string | null) ?? null,
      plan,
      addons: {
        concierge: Boolean(v.directory_addon_concierge),
        verified:  Boolean(v.directory_addon_verified),
        sponsored: Boolean(v.directory_addon_sponsored),
      },
      a2p: {
        verified:        Boolean(v.a2p_verified),
        brand_status:    (v.a2p_brand_status as string | null) ?? null,
        campaign_status: (v.a2p_campaign_status as string | null) ?? null,
      },
      ghl_connected:        Boolean(v.ghl_connected),
      ai_concierge_enabled: Boolean(v.ai_concierge_enabled),
      ai_persona:           (v.ai_assistant_persona_name as string | null) ?? null,
      open_tickets_count:   openTicketsCount ?? 0,
      concierge_notify_emails: (v.ai_concierge_notify_emails as string[] | null) ?? [],
    } : null,
    recent_activity: recentActivity,
    lead_id: (lead?.id as string | null) ?? null,
    venue_customer_id: t.venue_customer_id,
    pipelines: pipelinesWithStages,
    tags: venueTags,
    applied_tag_ids: appliedTagIds,
  });
}
