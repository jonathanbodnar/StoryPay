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
 * - Insert a `leads` row for venue_customers with no matching lead (real
 *   emails only)
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

  // Load the venue's current pipelines + stages once so we can diff against
  // whatever the leads table has. A single round-trip keeps this cheap even
  // for venues with hundreds of leads.
  const [{ data: pipelineRows }, { data: stageRows }, { data: leadRows }] = await Promise.all([
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
      .select('id, pipeline_id, stage_id')
      .eq('venue_id', venueId),
  ]);

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

  // Bucket leads that need fixing by the stage they should land in so we can
  // do a single UPDATE per target stage instead of one query per lead.
  const repairs = new Map<string, { pipeline_id: string; stage_id: string; status: string; ids: string[] }>();
  const needsRepair = (l: { id: string; pipeline_id: string | null; stage_id: string | null }) => {
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

  for (const l of (leadRows ?? []) as Array<{ id: string; pipeline_id: string | null; stage_id: string | null }>) {
    const fix = needsRepair(l);
    if (!fix) continue;
    const key = `${fix.pid}::${fix.stage.id}`;
    const bucket = repairs.get(key) ?? {
      pipeline_id: fix.pid,
      stage_id: fix.stage.id,
      status: legacyStatusForStageName(fix.stage.name),
      ids: [] as string[],
    };
    bucket.ids.push(l.id);
    repairs.set(key, bucket);
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

  const { data: leadEmailRows } = await supabaseAdmin.from('leads').select('email').eq('venue_id', venueId);
  const emailSet = new Set(
    (leadEmailRows ?? []).map((x) => String(x.email || '').trim().toLowerCase()).filter(Boolean),
  );

  const { data: vcs } = await supabaseAdmin
    .from('venue_customers')
    .select('customer_email, first_name, last_name, phone, pipeline_id, stage_id')
    .eq('venue_id', venueId);

  for (const vc of vcs ?? []) {
    const em = String(vc.customer_email || '').trim().toLowerCase();
    if (!isRealLeadEmail(em) || emailSet.has(em)) continue;

    let pid = vc.pipeline_id as string | null;
    let sid = vc.stage_id as string | null;

    if (pid && sid) {
      const ok = await validateStageInPipeline(venueId, pid, sid);
      if (!ok) {
        pid = null;
        sid = null;
      }
    }

    if (!pid || !sid) {
      pid = defaultPipelineId;
      sid = defFirst.id;
    }

    const stOk = await validateStageInPipeline(venueId, pid, sid);
    const stageNameForStatus = stOk?.name ?? defFirst.name;
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
