/**
 * GET /api/admin/support/bride-context/[threadId]
 *
 * Returns a unified payload of bride + venue context that the support sidebar
 * needs to display at-a-glance information without flipping tabs.
 *
 * The shape is *flat* and forgiving — every field is optional so the UI can
 * gracefully degrade when a piece of data isn't present (e.g. lead doesn't
 * exist yet for an inbound that hasn't been matched).
 *
 * ── Performance notes ────────────────────────────────────────────────────────
 * The original route had ~18 sequential DB roundtrips. This version uses three
 * parallel phases to reduce wall-clock time to ~4 roundtrips:
 *
 *  Phase 1 — Thread fetch (needed for venue_id / venue_customer_id)
 *  Phase 2 — 8 independent queries fire in parallel immediately after Phase 1
 *             (venue, customer, teamMembers, openTickets, messageCount,
 *              pipelineRows, allStageRows, marketingTags)
 *             + sysTagsPromise kicked off (usually instant via in-process cache)
 *  Phase 3 — 4 queries that need Phase-2 data fire in parallel
 *             (plan, sisterVC email, sisterVC phone, findMatchingLeadIds)
 *  Phase 4 — Lead rows fetch (needs matchedLeadIds from Phase 3)
 *  Phase 5 — 3 queries fire in parallel after lead resolution
 *             (leadActivity, aiHandoff, tagAssignments)
 *             + sysTagsPromise is awaited here (needed before tag query)
 *
 * Stage + pipeline lookups are now pure in-memory lookups against the
 * allStageRows / pipelineRows already fetched in Phase 2 — zero extra DB
 * round-trips.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { findMatchingLeadIds } from '@/lib/find-matching-leads';
import { capitalizeName } from '@/lib/format-name';

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

  // ── Phase 1: Thread ──────────────────────────────────────────────────────────
  const { data: thread } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, venue_customer_id, last_message_at, created_at')
    .eq('id', threadId)
    .maybeSingle();

  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

  const t = thread as {
    id: string;
    venue_id: string;
    venue_customer_id: string;
    last_message_at: string;
    created_at: string;
  };

  // ── Phase 2: All venue-level data in parallel ─────────────────────────────
  // All 8 queries are independent — they only need venue_id / threadId which
  // we have from Phase 1. Pipeline stages are fetched by venue_id so we can
  // look up any stage later with a pure in-memory find() instead of a DB hit.
  const [
    { data: venue, error: venueErr },
    { data: customer, error: customerErr },
    { data: teamMemberRows },
    { count: openTicketsCount },
    { count: messageCount },
    { data: pipelineRows },
    { data: allStageRows },
    { data: tagRows },
  ] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select(`
        id, name, notification_email, notification_phone, timezone, created_at,
        directory_plan_id, directory_addon_concierge, directory_addon_verified, directory_addon_sponsored,
        venue_concierge,
        a2p_verified, a2p_brand_status, a2p_campaign_status,
        ghl_connected,
        ai_concierge_enabled, ai_assistant_persona_name,
        ai_concierge_notify_emails,
        owner_first_name, owner_last_name, email, phone
      `)
      .eq('id', t.venue_id)
      .maybeSingle(),

    // Use * so a missing column never silently zeros stage_id/pipeline_id
    // out of the response (we read those fields below).
    supabaseAdmin
      .from('venue_customers')
      .select('*')
      .eq('id', t.venue_customer_id)
      .maybeSingle(),

    supabaseAdmin
      .from('venue_team_members')
      .select('id, first_name, last_name, email, phone, role')
      .eq('venue_id', t.venue_id)
      .order('created_at', { ascending: true }),

    supabaseAdmin
      .from('support_threads')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', t.venue_id)
      .in('status', ['open', 'pending']),

    supabaseAdmin
      .from('conversation_messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId),

    supabaseAdmin
      .from('lead_pipelines')
      .select('id, name, is_default, position')
      .eq('venue_id', t.venue_id)
      .order('position', { ascending: true }),

    // Fetch ALL stages for this venue upfront so stage+pipeline lookup later
    // is a pure in-memory find() — no extra DB roundtrip.
    supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, pipeline_id, name, color, kind, position')
      .eq('venue_id', t.venue_id)
      .order('position', { ascending: true }),

    supabaseAdmin
      .from('marketing_tags')
      .select('id, name, icon, color, position, is_system, system_key, category')
      .eq('venue_id', t.venue_id)
      .order('position', { ascending: true }),
  ]);

  if (venueErr) console.error('[bride-context] venues select failed', { threadId, err: venueErr.message });
  if (customerErr) console.error('[bride-context] venue_customers select failed', { threadId, err: customerErr.message });

  // Kick off system-tag seeding now — usually a near-instant no-op thanks to
  // the in-process SEEDED cache. We await it in Phase 5 (before the tag query)
  // since Railway kills fire-and-forget promises once the response is sent.
  const sysTagsPromise = (async () => {
    try {
      const { ensureSystemTagsForVenue } = await import('@/lib/system-tags');
      await ensureSystemTagsForVenue(t.venue_id);
    } catch (e) {
      console.error('[bride-context] system-tags seed error:', e);
    }
  })();

  const v = venue as Record<string, unknown> | null;
  const c = customer as Record<string, unknown> | null;

  const vcEmail = ((c?.customer_email as string) || '').trim().toLowerCase();
  const vcPhone = ((c?.phone as string) || '').trim();

  // ── Phase 3: All customer/venue-dependent queries in parallel ─────────────
  const [planRow, vcByEmail, vcByPhone, matchedIds] = await Promise.all([
    // Plan lookup — needs venue.directory_plan_id from Phase 2
    v?.directory_plan_id
      ? supabaseAdmin
          .from('directory_plans')
          .select('id, name, price_cents, is_legacy')
          .eq('id', v.directory_plan_id as string)
          .maybeSingle()
          .then(r => r.data)
      : Promise.resolve(null),

    // Sister venue_customers by email (parallel with phone below)
    vcEmail
      ? supabaseAdmin
          .from('venue_customers')
          .select('id, stage_id, updated_at')
          .eq('venue_id', t.venue_id)
          .ilike('customer_email', vcEmail)
          .order('updated_at', { ascending: false })
          .then(r => r.data)
      : Promise.resolve(null),

    // Sister venue_customers by phone
    vcPhone
      ? supabaseAdmin
          .from('venue_customers')
          .select('id, stage_id, updated_at')
          .eq('venue_id', t.venue_id)
          .eq('phone', vcPhone)
          .order('updated_at', { ascending: false })
          .then(r => r.data)
      : Promise.resolve(null),

    // Lead matching — findMatchingLeadIds now uses Promise.all internally
    c
      ? findMatchingLeadIds({
          venueId: t.venue_id,
          email: c.customer_email as string | null,
          phone: c.phone as string | null,
        })
      : Promise.resolve(new Set<string>()),
  ]);

  // Resolve sister VC canonical stage (needed for stage picker)
  const allMatchingVcIds = new Set<string>();
  if (c?.id) allMatchingVcIds.add(c.id as string);
  let canonicalVcStageId: string | null = (c?.stage_id as string | null) ?? null;

  for (const row of ([...(vcByEmail ?? []), ...(vcByPhone ?? [])]) as Array<{ id: string; stage_id?: string | null }>) {
    allMatchingVcIds.add(row.id);
    if (row.stage_id && !canonicalVcStageId) canonicalVcStageId = row.stage_id;
  }

  const allMatchingLeadIds = new Set<string>(matchedIds);

  // ── Phase 4: Lead rows ───────────────────────────────────────────────────
  const LEAD_FIELDS = `
    id, first_name, last_name, email, phone, status, source, referral_source, first_touch_utm, created_at,
    ai_state, ai_first_activated_at, ai_expires_at, ai_next_send_at,
    ai_attempt_count, ai_re_enable_count, ai_re_enabled_at,
    last_inbound_at, last_outbound_at,
    stage_id, pipeline_id
  `;

  let lead: Record<string, unknown> | null = null;
  if (allMatchingLeadIds.size > 0) {
    const { data: rows } = await supabaseAdmin
      .from('leads')
      .select(LEAD_FIELDS)
      .eq('venue_id', t.venue_id)
      .in('id', Array.from(allMatchingLeadIds))
      .order('created_at', { ascending: false });
    for (const l of (rows ?? []) as Array<Record<string, unknown>>) {
      if (!lead || (!lead.stage_id && l.stage_id)) lead = l;
    }
  }

  // ── Stage + pipeline resolution (pure in-memory — no DB roundtrip) ────────
  // allStageRows and pipelineRows were fetched in Phase 2.
  const stageId =
    canonicalVcStageId ||
    (c?.stage_id as string | null) ||
    (lead?.stage_id as string | null) ||
    null;

  type StageRow = { id: string; pipeline_id: string; name: string; color: string | null; kind: string; position: number };
  type PipelineRow = { id: string; name: string; is_default: boolean; position: number };

  const stageObj = stageId
    ? ((allStageRows ?? []) as StageRow[]).find(s => s.id === stageId) ?? null
    : null;
  const pipelineObj = stageObj
    ? ((pipelineRows ?? []) as PipelineRow[]).find(p => p.id === stageObj.pipeline_id) ?? null
    : null;

  let pipelineStage: { id: string; name: string; color: string | null; pipeline_id: string; pipeline_name: string } | null = null;
  if (stageObj && pipelineObj) {
    pipelineStage = {
      id:            stageObj.id,
      name:          stageObj.name,
      color:         stageObj.color,
      pipeline_id:   stageObj.pipeline_id,
      pipeline_name: pipelineObj.name,
    };
  } else if (!stageId) {
    console.warn('[bride-context] no stageId resolved', {
      threadId,
      vc_stage_id:     c?.stage_id ?? null,
      lead_stage_id:   lead?.stage_id ?? null,
      vc_id:           t.venue_customer_id,
      vc_email:        c?.customer_email ?? null,
      vc_phone:        c?.phone ?? null,
      matching_leads:  allMatchingLeadIds.size,
    });
  }

  // Pipelines with stages built purely from in-memory data — no extra query
  const pipelinesWithStages = ((pipelineRows ?? []) as PipelineRow[]).map(p => {
    const stages = ((allStageRows ?? []) as StageRow[])
      .filter(s => s.pipeline_id === p.id)
      .map(s => ({ id: s.id, name: s.name, color: s.color, kind: s.kind, position: s.position }));
    return { id: p.id, name: p.name, is_default: !!p.is_default, stages };
  });

  // Plan shape
  let plan: { id: string; name: string; price_cents: number; is_legacy: boolean } | null = null;
  if (planRow) {
    const p = planRow as { id: string; name: string; price_cents: number; is_legacy: boolean };
    plan = p;
  }

  // ── Phase 5: All post-lead queries in parallel + await sys-tags ───────────
  // Await system tags before the tag query (Railway kills fire-and-forget).
  // Lead creation for brand-new contacts (no lead yet) also happens here.
  await sysTagsPromise;

  if (!lead && c) {
    const email = vcEmail;
    const phone = vcPhone;
    const fn    = ((c.first_name as string) || '').trim();
    const ln    = ((c.last_name  as string) || '').trim();
    const name  = [fn, ln].filter(Boolean).join(' ') || email || phone || null;
    if (name) {
      try {
        const { applySystemTags } = await import('@/lib/system-tags');
        let newLeadId: string | null = null;
        if (email) {
          const { data: existing } = await supabaseAdmin
            .from('leads')
            .select('id')
            .eq('venue_id', t.venue_id)
            .ilike('email', email)
            .limit(1);
          newLeadId = (existing?.[0] as { id: string } | undefined)?.id ?? null;
        }
        if (!newLeadId) {
          const { data: inserted } = await supabaseAdmin
            .from('leads')
            .insert({
              venue_id:   t.venue_id,
              name,
              first_name: fn || null,
              last_name:  ln || null,
              email:      email || null,
              phone:      phone || null,
              source:     'contact',
              status:     'new',
              position:   0,
            })
            .select('id, created_at')
            .maybeSingle();
          const insertedRow = inserted as { id: string; created_at?: string } | null;
          newLeadId = insertedRow?.id ?? null;
          // Safety net: if this insert raced with another creator of the same
          // contact (or the email-only check above missed a phone-only sister
          // row), merge the exact email+phone duplicate immediately instead of
          // leaving two lead rows for one person.
          if (newLeadId) {
            const { autoMergeExactDuplicates } = await import('@/lib/merge-leads');
            const merge = await autoMergeExactDuplicates(
              t.venue_id,
              newLeadId,
              email,
              phone,
              insertedRow?.created_at ?? new Date().toISOString(),
            );
            if (merge) newLeadId = merge.mergedInto;
          }
        }
        if (newLeadId) {
          await applySystemTags(t.venue_id, newLeadId, ['new_lead', 'inquiry_received']);
          allMatchingLeadIds.add(newLeadId);
        }
      } catch (e) {
        console.error('[bride-context] lead creation error:', e);
      }
    }
  }

  const [activityRows, handoffTrans, tagAssigns] = await Promise.all([
    lead?.id
      ? supabaseAdmin
          .from('lead_activity_log')
          .select('action, created_at, details')
          .eq('lead_id', lead.id as string)
          .order('created_at', { ascending: false })
          .limit(5)
          .then(r => r.data ?? [])
      : Promise.resolve([]),

    lead?.id
      ? supabaseAdmin
          .from('ai_state_transitions')
          .select('to_state, reason, trigger_keyword, created_at')
          .eq('lead_id', lead.id as string)
          .eq('to_state', 'handoff')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(r => r.data)
      : Promise.resolve(null),

    allMatchingLeadIds.size > 0
      ? supabaseAdmin
          .from('lead_tag_assignments')
          .select('tag_id')
          .eq('venue_id', t.venue_id)
          .in('lead_id', Array.from(allMatchingLeadIds))
          .then(r => {
            if (r.error) {
              console.error('[bride-context] lead_tag_assignments lookup failed', {
                threadId, lead_ids: Array.from(allMatchingLeadIds), err: r.error.message,
              });
            }
            return r.data ?? [];
          })
      : Promise.resolve([]),
  ]);

  // AI handoff
  let aiHandoff: { at: string; reason: string | null; trigger: string | null } | null = null;
  if (handoffTrans) {
    const tr = handoffTrans as { reason: string | null; trigger_keyword: string | null; created_at: string };
    aiHandoff = { at: tr.created_at, reason: tr.reason, trigger: tr.trigger_keyword };
  }

  // Recent activity
  const recentActivity = ((activityRows ?? []) as Array<{ action: string; created_at: string; details: unknown }>)
    .map(a => ({ action: a.action, at: a.created_at, details: a.details }));

  // Applied tag IDs (deduplicated across all matching leads)
  const appliedTagIds: string[] = [];
  {
    const seen = new Set<string>();
    for (const a of (tagAssigns as Array<{ tag_id: string }>) ?? []) {
      if (!seen.has(a.tag_id)) {
        seen.add(a.tag_id);
        appliedTagIds.push(a.tag_id);
      }
    }
    console.warn('[bride-context] tag lookup result', {
      threadId,
      lead_ids:      Array.from(allMatchingLeadIds),
      assigns_count: (tagAssigns as Array<unknown>).length,
      tags_returned: appliedTagIds.length,
    });
  }

  const venueTags = ((tagRows ?? []) as Array<{
    id: string; name: string; icon: string; color: string | null;
    is_system?: boolean; system_key?: string | null; category?: string | null;
  }>);

  // Resolve a human-readable attribution label from the lead's raw source fields.
  function resolveLeadSource(l: Record<string, unknown> | null): string | null {
    if (!l) return null;
    const utm = (l.first_touch_utm ?? {}) as Record<string, string>;
    if (utm.fbclid)     return 'Facebook Ads';
    if (utm.utm_source) return utm.utm_source.charAt(0).toUpperCase() + utm.utm_source.slice(1);
    const ref = (l.referral_source as string | null) ?? null;
    if (ref) {
      try {
        const host = new URL(ref).hostname.replace(/^www\./, '');
        return host || ref;
      } catch {
        return ref;
      }
    }
    const src = (l.source as string | null) ?? null;
    if (!src || src === 'contact') return 'Direct';
    return src.charAt(0).toUpperCase() + src.slice(1).replace(/_/g, ' ');
  }

  return NextResponse.json({
    bride: {
      first_name:    capitalizeName((c?.first_name as string | null) ?? null) || null,
      last_name:     capitalizeName((c?.last_name  as string | null) ?? null) || null,
      email:         (c?.customer_email as string | null) ?? null,
      phone:         (c?.phone as string | null) ?? null,
      sms_dnd:       Boolean(c?.sms_dnd),
      conversation_dnd_all: Boolean(c?.conversation_dnd_all),
      submitted_at:  (lead?.created_at as string | null) ?? (c?.created_at as string | null) ?? null,
      lead_source:   resolveLeadSource(lead),
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
      state:              (lead.ai_state as string | null) ?? 'dormant',
      first_activated_at: (lead.ai_first_activated_at as string | null) ?? null,
      expires_at:         (lead.ai_expires_at as string | null) ?? null,
      next_send_at:       (lead.ai_next_send_at as string | null) ?? null,
      attempt_count:      (lead.ai_attempt_count as number | null) ?? 0,
      re_enable_count:    (lead.ai_re_enable_count as number | null) ?? 0,
      last_inbound_at:    (lead.last_inbound_at as string | null) ?? null,
      last_outbound_at:   (lead.last_outbound_at as string | null) ?? null,
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
      venue_concierge: Boolean(v.venue_concierge),
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
      contacts: (() => {
        const list: Array<{ id: string; name: string; role: string; email: string | null; phone: string | null }> = [];
        const ownerFirst = capitalizeName((v.owner_first_name as string | null) ?? '');
        const ownerLast  = capitalizeName((v.owner_last_name  as string | null) ?? '');
        const ownerName  = [ownerFirst, ownerLast].filter(Boolean).join(' ') || (v.name as string);
        list.push({
          id:    `owner:${v.id as string}`,
          name:  ownerName,
          role:  'Owner',
          email: (v.email as string | null) ?? null,
          phone: (v.notification_phone as string | null) ?? (v.phone as string | null) ?? (c?.phone as string | null) ?? null,
        });
        for (const m of (teamMemberRows ?? []) as Array<{
          id: string; first_name: string | null; last_name: string | null;
          email: string | null; phone: string | null; role: string | null;
        }>) {
          const fn2 = capitalizeName(m.first_name ?? '');
          const ln2 = capitalizeName(m.last_name  ?? '');
          list.push({
            id:    m.id,
            name:  [fn2, ln2].filter(Boolean).join(' ') || m.email || 'Team member',
            role:  m.role ?? 'Team',
            email: m.email ?? null,
            phone: m.phone ?? null,
          });
        }
        return list;
      })(),
    } : null,
    recent_activity: recentActivity,
    lead_id:           (lead?.id as string | null) ?? null,
    venue_customer_id: t.venue_customer_id,
    pipelines: pipelinesWithStages,
    tags: venueTags.map(t2 => ({
      id:         t2.id,
      name:       t2.name,
      icon:       t2.icon,
      color:      t2.color,
      is_system:  t2.is_system ?? false,
      system_key: t2.system_key ?? null,
      category:   t2.category ?? null,
    })),
    applied_tag_ids: appliedTagIds,
  });
}
