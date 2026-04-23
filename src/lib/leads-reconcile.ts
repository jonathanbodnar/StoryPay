import { supabaseAdmin } from '@/lib/supabase';
import { ensureDefaultPipeline, legacyStatusForStageName } from '@/lib/pipelines';
import { recordDuplicateCandidatesForNewLead } from '@/lib/lead-duplicates';

export function isRealLeadEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e || !e.includes('@')) return false;
  if (e.endsWith('@storypay.internal')) return false;
  if (e.includes('@ghl-sms.storypay.placeholder')) return false;
  return true;
}

async function firstStageForPipeline(venueId: string, pipelineId: string) {
  const { data } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .select('id, name')
    .eq('venue_id', venueId)
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data as { id: string; name: string } | null;
}

async function validateStageInPipeline(venueId: string, pipelineId: string, stageId: string) {
  const { data } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .select('name, pipeline_id')
    .eq('id', stageId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!data || data.pipeline_id !== pipelineId) return null;
  return { name: data.name as string };
}

/**
 * When a venue_customer is updated but no `leads` row exists for that email,
 * create one so the Kanban and sync stay aligned.
 */
export async function createLeadFromVenueCustomerIfMissing(
  venueId: string,
  vc: { customer_email: string; pipeline_id: string | null; stage_id: string | null },
): Promise<void> {
  const email = (vc.customer_email || '').trim().toLowerCase();
  if (!email || !vc.pipeline_id || !vc.stage_id || !isRealLeadEmail(email)) return;

  const st = await validateStageInPipeline(venueId, vc.pipeline_id, vc.stage_id);
  if (!st) return;

  const { data: existing } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('venue_id', venueId)
    .ilike('email', email)
    .limit(1);
  if (existing?.length) return;

  const { data: fullVc } = await supabaseAdmin
    .from('venue_customers')
    .select('first_name, last_name, phone')
    .eq('venue_id', venueId)
    .ilike('customer_email', email)
    .maybeSingle();

  const fn = String(fullVc?.first_name || '');
  const ln = String(fullVc?.last_name || '');
  const name = [fn, ln].filter(Boolean).join(' ') || email;
  const status = legacyStatusForStageName(st.name);
  const now = new Date().toISOString();
  const phone = String(fullVc?.phone || '');

  const { data: inserted, error } = await supabaseAdmin
    .from('leads')
    .insert({
      venue_id: venueId,
      name,
      first_name: fn || null,
      last_name: ln || null,
      email,
      phone,
      source: 'contact',
      status,
      pipeline_id: vc.pipeline_id,
      stage_id: vc.stage_id,
      position: 0,
      updated_at: now,
    })
    .select('id, created_at')
    .single();

  if (error || !inserted) {
    console.error('[createLeadFromVenueCustomerIfMissing]', error);
    return;
  }

  void recordDuplicateCandidatesForNewLead(
    venueId,
    inserted.id as string,
    email,
    phone.trim() || null,
    String((inserted as { created_at?: string }).created_at ?? now),
  );
}

/**
 * Idempotent fixes so the sales pipeline shows every inquirer:
 * - Assign default pipeline + first stage to leads missing pipeline_id
 * - Reset leads whose pipeline_id points at a deleted pipeline to the default
 * - Fill stage_id when pipeline_id is set but stage is null OR the stage_id
 *   references a deleted/cross-pipeline stage
 * - Snap each lead to the pipeline/stage stored on its matching
 *   `venue_customers` row so "contact stage" is always the source of truth
 *   (otherwise a lead stuck in an older pipeline never shows up in the
 *   pipeline the user picked on the contacts/leads page).
 * - Insert a `leads` row for venue_customers with no matching lead (real
 *   emails only) so every contact is visible on the Kanban.
 *
 * All failures are swallowed (logged) so a slow/stale DB doesn't 500 the
 * leads page — a lead stuck in the wrong place is preferable to no leads
 * showing up at all.
 */
export async function reconcileLeadsForKanban(venueId: string): Promise<void> {
  const defaultPipelineId = await ensureDefaultPipeline(venueId);
  const defFirst = await firstStageForPipeline(venueId, defaultPipelineId);
  if (!defFirst) return;

  const now = new Date().toISOString();

  // Load the venue's current pipelines + stages + leads + contacts in one
  // round-trip. Cheap even for venues with hundreds of rows.
  const leadsSelectWithFlag = 'id, email, pipeline_id, stage_id, excluded_from_pipeline';
  const leadsSelectLegacy = 'id, email, pipeline_id, stage_id';
  const [{ data: pipelineRows }, { data: stageRows }, leadsResult, { data: vcs }] =
    await Promise.all([
      supabaseAdmin
        .from('lead_pipelines')
        .select('id')
        .eq('venue_id', venueId),
      supabaseAdmin
        .from('lead_pipeline_stages')
        .select('id, pipeline_id, name, position')
        .eq('venue_id', venueId)
        .order('position', { ascending: true }),
      supabaseAdmin
        .from('leads')
        .select(leadsSelectWithFlag)
        .eq('venue_id', venueId),
      supabaseAdmin
        .from('venue_customers')
        .select('customer_email, first_name, last_name, phone, pipeline_id, stage_id')
        .eq('venue_id', venueId),
    ]);

  let leadRows: Array<{
    id: string;
    email: string | null;
    pipeline_id: string | null;
    stage_id: string | null;
    excluded_from_pipeline?: boolean | null;
  }> | null = leadsResult.data as unknown as Array<{
    id: string;
    email: string | null;
    pipeline_id: string | null;
    stage_id: string | null;
    excluded_from_pipeline?: boolean | null;
  }> | null;
  if (leadsResult.error && /column .*excluded_from_pipeline/i.test(leadsResult.error.message)) {
    // Migration 051 not applied yet — reconcile against the legacy columns
    // so the kanban still loads. Contact-only leads (when they exist) will
    // be re-bucketed into the default pipeline until the migration lands.
    const retry = await supabaseAdmin
      .from('leads')
      .select(leadsSelectLegacy)
      .eq('venue_id', venueId);
    leadRows = (retry.data ?? null) as unknown as Array<{
      id: string;
      email: string | null;
      pipeline_id: string | null;
      stage_id: string | null;
      excluded_from_pipeline?: boolean | null;
    }> | null;
  }

  const pipelineIds = new Set<string>(((pipelineRows ?? []) as Array<{ id: string }>).map((p) => p.id));
  type StageMini = { id: string; pipeline_id: string; name: string; position: number };
  const stagesById = new Map<string, StageMini>(
    ((stageRows ?? []) as StageMini[]).map((s) => [s.id, s]),
  );
  const firstStageByPipeline = new Map<string, StageMini>();
  for (const s of (stageRows ?? []) as StageMini[]) {
    const existing = firstStageByPipeline.get(s.pipeline_id);
    if (!existing || s.position < existing.position) firstStageByPipeline.set(s.pipeline_id, s);
  }

  type LeadMini = {
    id: string;
    email: string | null;
    pipeline_id: string | null;
    stage_id: string | null;
    excluded_from_pipeline?: boolean | null;
  };
  // Contact-only leads ("None" stage) must be skipped for healing + kanban
  // placement, but they still claim the email so we don't accidentally
  // clone them into the default pipeline down below.
  const allLeads = (leadRows ?? []) as LeadMini[];
  const leads = allLeads.filter((l) => l.excluded_from_pipeline !== true);

  // Build a lookup from contact email → its preferred pipeline/stage on the
  // venue_customers row. That's what the user just edited on the contacts
  // page, so leads should follow it.
  type VcPipelineInfo = { pipeline_id: string; stage_id: string; name: string };
  const vcPipelineByEmail = new Map<string, VcPipelineInfo>();
  for (const vc of (vcs ?? []) as Array<{
    customer_email: string | null;
    pipeline_id: string | null;
    stage_id: string | null;
  }>) {
    const em = String(vc.customer_email || '').trim().toLowerCase();
    const sid = vc.stage_id;
    if (!em || !sid) continue;
    const st = stagesById.get(sid);
    if (!st) continue;
    // Trust the stage's real pipeline so a stale/missing vc.pipeline_id doesn't
    // orphan the contact. Reject only when vc.pipeline_id is set AND contradicts.
    if (vc.pipeline_id && vc.pipeline_id !== st.pipeline_id) continue;
    vcPipelineByEmail.set(em, {
      pipeline_id: st.pipeline_id,
      stage_id: sid,
      name: st.name,
    });
  }

  // Bucket leads that need fixing by the target stage they should land in so
  // we can issue a single UPDATE per target stage instead of one per lead.
  type Repair = { pipeline_id: string; stage_id: string; status: string; ids: string[] };
  const repairs = new Map<string, Repair>();
  type StageTarget = { id: string; name: string };
  const bucketLead = (leadId: string, pid: string, stage: StageTarget) => {
    const key = `${pid}::${stage.id}`;
    const bucket = repairs.get(key) ?? {
      pipeline_id: pid,
      stage_id: stage.id,
      status: legacyStatusForStageName(stage.name),
      ids: [] as string[],
    };
    bucket.ids.push(leadId);
    repairs.set(key, bucket);
  };

  const healBrokenRefs = (l: LeadMini): { pid: string; stage: StageTarget } | null => {
    // Case 1: no pipeline at all → default + first stage
    if (!l.pipeline_id) return { pid: defaultPipelineId, stage: defFirst };
    // Case 2: pipeline points to a deleted pipeline → default + first stage
    if (!pipelineIds.has(l.pipeline_id)) return { pid: defaultPipelineId, stage: defFirst };
    // Case 3: no stage → first stage of the existing pipeline
    if (!l.stage_id) {
      const first = firstStageByPipeline.get(l.pipeline_id);
      return first ? { pid: l.pipeline_id, stage: first } : null;
    }
    // Case 4: stage points to a deleted stage OR belongs to a different
    // pipeline than the lead claims → first stage of the lead's pipeline
    const st = stagesById.get(l.stage_id);
    if (!st || st.pipeline_id !== l.pipeline_id) {
      const first = firstStageByPipeline.get(l.pipeline_id);
      return first ? { pid: l.pipeline_id, stage: first } : null;
    }
    return null;
  };

  for (const l of leads) {
    // Contact-profile stage wins when set: this is what the user just picked
    // on the contact, so the lead MUST appear in that pipeline + stage.
    const em = String(l.email || '').trim().toLowerCase();
    const vcTarget = em ? vcPipelineByEmail.get(em) : undefined;
    if (vcTarget && (l.pipeline_id !== vcTarget.pipeline_id || l.stage_id !== vcTarget.stage_id)) {
      bucketLead(l.id, vcTarget.pipeline_id, { id: vcTarget.stage_id, name: vcTarget.name });
      continue;
    }
    if (vcTarget) continue; // already in the right place

    const fix = healBrokenRefs(l);
    if (!fix) continue;
    bucketLead(l.id, fix.pid, fix.stage);
  }

  for (const bucket of repairs.values()) {
    if (bucket.ids.length === 0) continue;
    const { error } = await supabaseAdmin
      .from('leads')
      .update({
        pipeline_id: bucket.pipeline_id,
        stage_id: bucket.stage_id,
        status: bucket.status,
        updated_at: now,
      })
      .eq('venue_id', venueId)
      .in('id', bucket.ids);
    if (error) console.error('[reconcileLeadsForKanban] repair update failed:', error.message);
  }

  // Use *all* leads (including contact-only ones) so we don't clone a
  // contact-only lead into the default pipeline just because it was skipped
  // by the reconcile filter above.
  const emailSet = new Set(
    allLeads.map((l) => String(l.email || '').trim().toLowerCase()).filter(Boolean),
  );

  for (const vc of (vcs ?? []) as Array<{
    customer_email: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    pipeline_id: string | null;
    stage_id: string | null;
  }>) {
    const em = String(vc.customer_email || '').trim().toLowerCase();
    if (!isRealLeadEmail(em) || emailSet.has(em)) continue;

    let pid = vc.pipeline_id as string | null;
    let sid = vc.stage_id as string | null;

    if (pid && sid) {
      const st = stagesById.get(sid);
      if (!st || st.pipeline_id !== pid) {
        pid = null;
        sid = null;
      }
    }

    if (!pid || !sid) {
      pid = defaultPipelineId;
      sid = defFirst.id;
    }

    const stageNameForStatus = stagesById.get(sid)?.name ?? defFirst.name;
    const fn = String(vc.first_name || '');
    const ln = String(vc.last_name || '');
    const name = [fn, ln].filter(Boolean).join(' ') || em;
    const phone = String(vc.phone || '');

    const { data: inserted, error } = await supabaseAdmin
      .from('leads')
      .insert({
        venue_id: venueId,
        name,
        first_name: fn || null,
        last_name: ln || null,
        email: em,
        phone,
        source: 'contact',
        status: legacyStatusForStageName(stageNameForStatus),
        pipeline_id: pid,
        stage_id: sid,
        position: 0,
        updated_at: now,
      })
      .select('id, created_at')
      .single();

    if (error) {
      console.error('[reconcileLeadsForKanban] insert lead', error);
      continue;
    }

    emailSet.add(em);

    void recordDuplicateCandidatesForNewLead(
      venueId,
      (inserted as { id: string }).id,
      em,
      phone.trim() || null,
      String((inserted as { created_at?: string }).created_at ?? now),
    );
  }
}
