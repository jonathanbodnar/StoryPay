import { supabaseAdmin } from '@/lib/supabase';
import type { CampaignSegment } from '@/lib/marketing-email-schema';

export interface LeadRecipient {
  id: string;
  email: string;
}

async function leadIdsWhoClickedLinks(venueId: string, linkIds: string[]): Promise<Set<string>> {
  if (linkIds.length === 0) return new Set();
  const { data: rows } = await supabaseAdmin
    .from('lead_marketing_events')
    .select('lead_id')
    .eq('venue_id', venueId)
    .eq('event_type', 'trigger_link_click')
    .in('trigger_link_id', linkIds);
  const s = new Set<string>();
  for (const r of rows ?? []) {
    const id = (r as { lead_id: string | null }).lead_id;
    if (id) s.add(id);
  }
  return s;
}

function applyBehaviorFilters(
  rows: Array<{ id: string; email: string | null; stage_id?: string | null; wedding_date?: string | null }>,
  segment: CampaignSegment,
  suppressed: Set<string>,
  clickedSet: Set<string>,
): LeadRecipient[] {
  let list = rows.filter((l) => l.email && !suppressed.has(l.id));

  const ex = segment.exclude_stage_ids?.filter(Boolean) ?? [];
  if (ex.length) {
    list = list.filter((l) => !l.stage_id || !ex.includes(l.stage_id));
  }

  if (segment.require_wedding_date) {
    list = list.filter((l) => !!l.wedding_date);
  }

  const clk = segment.clicked_trigger_link_ids?.filter(Boolean) ?? [];
  if (clk.length) {
    list = list.filter((l) => clickedSet.has(l.id));
  }

  const bookedStages = segment.booked_stage_ids?.filter(Boolean) ?? [];
  if (segment.require_not_booked && bookedStages.length) {
    list = list.filter((l) => !l.stage_id || !bookedStages.includes(l.stage_id));
  }

  return list.map((l) => ({ id: l.id, email: l.email!.trim() }));
}

export async function resolveCampaignRecipients(
  venueId: string,
  segment: CampaignSegment,
): Promise<LeadRecipient[]> {
  const suppressed = new Set<string>();
  const { data: sup } = await supabaseAdmin
    .from('marketing_email_suppressions')
    .select('lead_id')
    .eq('venue_id', venueId);
  for (const r of sup ?? []) suppressed.add((r as { lead_id: string }).lead_id);

  const clk = segment.clicked_trigger_link_ids?.filter(Boolean) ?? [];
  const clickedSet =
    clk.length > 0 ? await leadIdsWhoClickedLinks(venueId, clk) : new Set<string>();

  const selectCols = 'id, email, stage_id, wedding_date';

  if (segment.type === 'tags_any' && (segment.tag_ids?.length ?? 0) > 0) {
    const { data: rows, error } = await supabaseAdmin
      .from('lead_tag_assignments')
      .select('lead_id')
      .eq('venue_id', venueId)
      .in('tag_id', segment.tag_ids!);
    if (error || !rows?.length) return [];
    const ids = [...new Set(rows.map((r: { lead_id: string }) => r.lead_id))];
    const { data: leads, error: le } = await supabaseAdmin
      .from('leads')
      .select(selectCols)
      .eq('venue_id', venueId)
      .in('id', ids);
    if (le || !leads) return [];
    return applyBehaviorFilters(
      leads as Array<{ id: string; email: string | null; stage_id: string | null; wedding_date: string | null }>,
      segment,
      suppressed,
      clickedSet,
    );
  }

  if (segment.type === 'stages' && (segment.stage_ids?.length ?? 0) > 0) {
    const { data: leads, error } = await supabaseAdmin
      .from('leads')
      .select(selectCols)
      .eq('venue_id', venueId)
      .in('stage_id', segment.stage_ids!);
    if (error || !leads) return [];
    return applyBehaviorFilters(
      leads as Array<{ id: string; email: string | null; stage_id: string | null; wedding_date: string | null }>,
      segment,
      suppressed,
      clickedSet,
    );
  }

  const { data: leads, error } = await supabaseAdmin.from('leads').select(selectCols).eq('venue_id', venueId);
  if (error || !leads) return [];
  return applyBehaviorFilters(
    leads as Array<{ id: string; email: string | null; stage_id: string | null; wedding_date: string | null }>,
    segment,
    suppressed,
    clickedSet,
  );
}
