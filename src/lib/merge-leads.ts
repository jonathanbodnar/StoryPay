import { supabaseAdmin } from '@/lib/supabase';
import { insertLeadActivity } from '@/lib/lead-activity';
import { refreshDuplicateCandidatesForLead } from '@/lib/lead-duplicates';
import { syncVenueCustomerFromLeadRow } from '@/lib/venue-customer-pipeline-sync';

type LeadRow = Record<string, unknown>;

function str(a: unknown): string {
  return typeof a === 'string' ? a : '';
}

function mergeLeadFields(keep: LeadRow, merge: LeadRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const pickStr = (k: string) => {
    const a = str(keep[k]).trim();
    const b = str(merge[k]).trim();
    out[k] = a || b || (keep[k] ?? merge[k] ?? '');
  };

  pickStr('first_name');
  pickStr('last_name');
  const fn = str(out.first_name);
  const ln = str(out.last_name);
  const nameFromParts = [fn, ln].filter(Boolean).join(' ').trim();
  const keepName = str(keep.name).trim();
  const mergeName = str(merge.name).trim();
  out.name = nameFromParts || keepName || mergeName;

  pickStr('email');
  pickStr('phone');

  const msgK = str(keep.message).trim();
  const msgM = str(merge.message).trim();
  if (msgK && msgM && msgK !== msgM) out.message = `${msgK}\n\n---\n${msgM}`;
  else out.message = msgK || msgM || null;

  const notesK = str(keep.notes).trim();
  const notesM = str(merge.notes).trim();
  if (notesK && notesM && notesK !== notesM) out.notes = `${notesK}\n\n---\n${notesM}`;
  else out.notes = notesK || notesM || null;

  const vk = keep.opportunity_value;
  const vm = merge.opportunity_value;
  const nk = typeof vk === 'number' ? vk : vk != null ? Number(vk) : null;
  const nm = typeof vm === 'number' ? vm : vm != null ? Number(vm) : null;
  if (nk != null && !Number.isNaN(nk) && nm != null && !Number.isNaN(nm)) {
    out.opportunity_value = Math.max(nk, nm);
  } else {
    out.opportunity_value = nk ?? nm ?? null;
  }

  const gk = keep.guest_count;
  const gm = merge.guest_count;
  const igk = typeof gk === 'number' ? gk : gk != null ? Number(gk) : null;
  const igm = typeof gm === 'number' ? gm : gm != null ? Number(gm) : null;
  if (igk != null && !Number.isNaN(igk) && igm != null && !Number.isNaN(igm)) {
    out.guest_count = Math.max(igk, igm);
  } else {
    out.guest_count = igk ?? igm ?? null;
  }

  out.wedding_date = keep.wedding_date ?? merge.wedding_date ?? null;
  out.booking_timeline = str(keep.booking_timeline).trim() || str(merge.booking_timeline).trim() || null;
  out.venue_name = str(keep.venue_name).trim() || str(merge.venue_name).trim() || null;
  out.venue_website_url = str(keep.venue_website_url).trim() || str(merge.venue_website_url).trim() || null;
  out.referral_source = str(keep.referral_source).trim() || str(merge.referral_source).trim() || null;
  out.lost_reason = str(keep.lost_reason).trim() || str(merge.lost_reason).trim() || null;

  const utmK = keep.first_touch_utm;
  const utmM = merge.first_touch_utm;
  if (
    utmK &&
    typeof utmK === 'object' &&
    !Array.isArray(utmK) &&
    Object.keys(utmK as object).length > 0
  ) {
    out.first_touch_utm = utmK;
  } else if (
    utmM &&
    typeof utmM === 'object' &&
    !Array.isArray(utmM) &&
    Object.keys(utmM as object).length > 0
  ) {
    out.first_touch_utm = utmM;
  }

  const optK = keep.marketing_email_opt_in;
  const optM = merge.marketing_email_opt_in;
  out.marketing_email_opt_in =
    optK === false || optM === false ? false : optK === true || optM === true ? true : null;

  out.assigned_member_id = keep.assigned_member_id ?? merge.assigned_member_id ?? null;

  out.pipeline_id = keep.pipeline_id ?? merge.pipeline_id ?? null;
  out.stage_id = keep.stage_id ?? merge.stage_id ?? null;
  out.position = typeof keep.position === 'number' ? keep.position : merge.position ?? 0;
  out.status = keep.status ?? merge.status;

  out.updated_at = new Date().toISOString();

  return out;
}

/**
 * Move all related rows from `mergeLeadId` onto `keepLeadId`, merge scalar fields onto keep, delete merged lead.
 */
export async function mergeLeadsInto(
  venueId: string,
  keepLeadId: string,
  mergeLeadId: string,
  actor: { memberId: string | null; isOwner: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (keepLeadId === mergeLeadId) return { ok: false, error: 'Cannot merge a lead into itself' };

  const { data: keep, error: e1 } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', keepLeadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  const { data: merge, error: e2 } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', mergeLeadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (e1 || e2 || !keep || !merge) {
    return { ok: false, error: 'Lead not found' };
  }

  const k = keep as LeadRow;
  const m = merge as LeadRow;

  await supabaseAdmin.from('lead_notes').update({ lead_id: keepLeadId }).eq('lead_id', mergeLeadId);

  await supabaseAdmin.from('lead_tasks').update({ lead_id: keepLeadId }).eq('lead_id', mergeLeadId);

  await supabaseAdmin.from('lead_activity_log').update({ lead_id: keepLeadId }).eq('lead_id', mergeLeadId);

  await supabaseAdmin.from('lead_marketing_events').update({ lead_id: keepLeadId }).eq('lead_id', mergeLeadId);

  const { data: mergeTagRows } = await supabaseAdmin
    .from('lead_tag_assignments')
    .select('tag_id')
    .eq('venue_id', venueId)
    .eq('lead_id', mergeLeadId);

  const { data: keepTagRows } = await supabaseAdmin
    .from('lead_tag_assignments')
    .select('tag_id')
    .eq('venue_id', venueId)
    .eq('lead_id', keepLeadId);

  const keepTags = new Set((keepTagRows ?? []).map((r) => String((r as { tag_id: string }).tag_id)));

  for (const row of mergeTagRows ?? []) {
    const tagId = String((row as { tag_id: string }).tag_id);
    if (keepTags.has(tagId)) {
      await supabaseAdmin
        .from('lead_tag_assignments')
        .delete()
        .eq('venue_id', venueId)
        .eq('lead_id', mergeLeadId)
        .eq('tag_id', tagId);
    } else {
      await supabaseAdmin
        .from('lead_tag_assignments')
        .update({ lead_id: keepLeadId })
        .eq('venue_id', venueId)
        .eq('lead_id', mergeLeadId)
        .eq('tag_id', tagId);
      keepTags.add(tagId);
    }
  }

  const { data: recips } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('id, campaign_id')
    .eq('venue_id', venueId)
    .eq('lead_id', mergeLeadId);

  for (const r of recips ?? []) {
    const row = r as { id: string; campaign_id: string };
    const { data: clash } = await supabaseAdmin
      .from('marketing_campaign_recipients')
      .select('id')
      .eq('venue_id', venueId)
      .eq('campaign_id', row.campaign_id)
      .eq('lead_id', keepLeadId)
      .maybeSingle();
    if (clash) {
      await supabaseAdmin.from('marketing_campaign_recipients').delete().eq('id', row.id);
    } else {
      await supabaseAdmin.from('marketing_campaign_recipients').update({ lead_id: keepLeadId }).eq('id', row.id);
    }
  }

  const { data: enrolls } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .select('id, automation_id')
    .eq('venue_id', venueId)
    .eq('lead_id', mergeLeadId);

  for (const r of enrolls ?? []) {
    const row = r as { id: string; automation_id: string };
    const { data: clash } = await supabaseAdmin
      .from('marketing_automation_enrollments')
      .select('id')
      .eq('venue_id', venueId)
      .eq('automation_id', row.automation_id)
      .eq('lead_id', keepLeadId)
      .maybeSingle();
    if (clash) {
      await supabaseAdmin.from('marketing_automation_enrollments').delete().eq('id', row.id);
    } else {
      await supabaseAdmin.from('marketing_automation_enrollments').update({ lead_id: keepLeadId }).eq('id', row.id);
    }
  }

  const { data: supKeep } = await supabaseAdmin
    .from('marketing_email_suppressions')
    .select('lead_id')
    .eq('venue_id', venueId)
    .eq('lead_id', keepLeadId)
    .maybeSingle();
  const { data: supMerge } = await supabaseAdmin
    .from('marketing_email_suppressions')
    .select('lead_id')
    .eq('venue_id', venueId)
    .eq('lead_id', mergeLeadId)
    .maybeSingle();

  if (supMerge) {
    if (supKeep) {
      await supabaseAdmin.from('marketing_email_suppressions').delete().eq('venue_id', venueId).eq('lead_id', mergeLeadId);
    } else {
      await supabaseAdmin
        .from('marketing_email_suppressions')
        .update({ lead_id: keepLeadId })
        .eq('venue_id', venueId)
        .eq('lead_id', mergeLeadId);
    }
  }

  const combined = mergeLeadFields(k, m);

  const { error: upErr } = await supabaseAdmin.from('leads').update(combined).eq('id', keepLeadId).eq('venue_id', venueId);
  if (upErr) {
    console.error('[mergeLeadsInto] update keep failed:', upErr.message);
    return { ok: false, error: upErr.message };
  }

  const { error: delErr } = await supabaseAdmin.from('leads').delete().eq('id', mergeLeadId).eq('venue_id', venueId);
  if (delErr) {
    console.error('[mergeLeadsInto] delete merged failed:', delErr.message);
    return { ok: false, error: delErr.message };
  }

  await insertLeadActivity({
    venueId,
    leadId: keepLeadId,
    actorMemberId: actor.memberId,
    actorIsOwner: actor.isOwner,
    action: 'leads_merged',
    details: { merged_lead_id: mergeLeadId },
  });

  await refreshDuplicateCandidatesForLead(venueId, keepLeadId);

  const em = str(combined.email);
  const pid = combined.pipeline_id as string | null | undefined;
  const sid = combined.stage_id as string | null | undefined;
  if (em && pid && sid) {
    void syncVenueCustomerFromLeadRow(venueId, { email: em, pipeline_id: pid, stage_id: sid });
  }

  return { ok: true };
}
