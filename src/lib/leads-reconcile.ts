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
 * - Fill stage_id when pipeline_id is set but stage is null
 * - Insert a `leads` row for venue_customers with no matching lead (real emails only)
 */
export async function reconcileLeadsForKanban(venueId: string): Promise<void> {
  const defaultPipelineId = await ensureDefaultPipeline(venueId);
  const defFirst = await firstStageForPipeline(venueId, defaultPipelineId);
  if (!defFirst) return;

  const now = new Date().toISOString();

  await supabaseAdmin
    .from('leads')
    .update({
      pipeline_id: defaultPipelineId,
      stage_id: defFirst.id,
      status: legacyStatusForStageName(defFirst.name),
      updated_at: now,
    })
    .eq('venue_id', venueId)
    .is('pipeline_id', null);

  const { data: missingStage } = await supabaseAdmin
    .from('leads')
    .select('id, pipeline_id')
    .eq('venue_id', venueId)
    .is('stage_id', null)
    .not('pipeline_id', 'is', null);

  for (const r of missingStage ?? []) {
    const pid = r.pipeline_id as string;
    const first = await firstStageForPipeline(venueId, pid);
    if (!first) continue;
    await supabaseAdmin
      .from('leads')
      .update({
        stage_id: first.id,
        status: legacyStatusForStageName(first.name),
        updated_at: now,
      })
      .eq('id', r.id as string)
      .eq('venue_id', venueId);
  }

  const { data: leadRows } = await supabaseAdmin.from('leads').select('email').eq('venue_id', venueId);
  const emailSet = new Set(
    (leadRows ?? []).map((x) => String(x.email || '').trim().toLowerCase()).filter(Boolean),
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
