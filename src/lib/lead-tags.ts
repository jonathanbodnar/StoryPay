import { supabaseAdmin } from '@/lib/supabase';

export interface LeadTagRow {
  id: string;
  name: string;
  icon: string;
  color: string | null;
}

/** All tag rows attached to the given leads (same venue). */
export async function fetchTagsForLeadIds(
  venueId: string,
  leadIds: string[],
): Promise<Map<string, LeadTagRow[]>> {
  const map = new Map<string, LeadTagRow[]>();
  for (const lid of leadIds) map.set(lid, []);
  if (leadIds.length === 0) return map;

  const { data: rows, error } = await supabaseAdmin
    .from('lead_tag_assignments')
    .select('lead_id, marketing_tags ( id, name, icon, color )')
    .eq('venue_id', venueId)
    .in('lead_id', leadIds);

  if (error || !rows) return map;

  for (const row of rows as Array<{
    lead_id: string;
    marketing_tags: LeadTagRow | LeadTagRow[] | null;
  }>) {
    const mt = row.marketing_tags;
    const tag = Array.isArray(mt) ? mt[0] : mt;
    if (!tag?.id) continue;
    const list = map.get(row.lead_id) ?? [];
    list.push({ id: tag.id, name: tag.name, icon: tag.icon, color: tag.color ?? null });
    map.set(row.lead_id, list);
  }
  return map;
}

/** Replace all tag assignments for a lead (only tags that belong to the venue). */
export async function setLeadTagIds(venueId: string, leadId: string, tagIds: string[]): Promise<void> {
  const unique = [...new Set(tagIds.filter((x) => typeof x === 'string'))];

  await supabaseAdmin.from('lead_tag_assignments').delete().eq('lead_id', leadId).eq('venue_id', venueId);

  if (unique.length === 0) return;

  const { data: valid } = await supabaseAdmin
    .from('marketing_tags')
    .select('id')
    .eq('venue_id', venueId)
    .in('id', unique);

  const allowed = new Set((valid ?? []).map((t: { id: string }) => t.id));
  const filtered = unique.filter((id) => allowed.has(id));
  if (filtered.length === 0) return;

  await supabaseAdmin.from('lead_tag_assignments').insert(
    filtered.map((tag_id) => ({ lead_id: leadId, tag_id, venue_id: venueId })),
  );
}

async function assignedMemberSummary(
  venueId: string,
  memberId: string,
): Promise<{ id: string; name: string; initials: string } | null> {
  const { data: mm } = await supabaseAdmin
    .from('venue_team_members')
    .select('id, first_name, last_name, name')
    .eq('venue_id', venueId)
    .eq('id', memberId)
    .maybeSingle();
  if (!mm) return null;
  const row = mm as { id: string; first_name: string | null; last_name: string | null; name: string | null };
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.name || 'Member';
  const initials = `${row.first_name?.[0] ?? ''}${row.last_name?.[0] ?? row.name?.[0] ?? '?'}`.slice(0, 2).toUpperCase() || '?';
  return { id: row.id, name, initials };
}

export async function leadRowWithTags(venueId: string, lead: Record<string, unknown>) {
  const m = await fetchTagsForLeadIds(venueId, [String(lead.id)]);
  const tags = m.get(String(lead.id)) ?? [];
  const aid = lead.assigned_member_id as string | null | undefined;
  let assigned_member: { id: string; name: string; initials: string } | null = null;
  if (typeof aid === 'string' && aid.length > 0) {
    assigned_member = await assignedMemberSummary(venueId, aid);
  }
  return { ...lead, tags, assigned_member };
}
