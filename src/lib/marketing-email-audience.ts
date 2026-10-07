import { supabaseAdmin } from '@/lib/supabase';
import { askInBatches, everyRow } from '@/lib/in-batches';
import {
  parseSavedSegmentDefinition,
  type CampaignSegment,
  type SavedSegmentDefinition,
} from '@/lib/marketing-email-schema';

export interface LeadRecipient {
  id: string;
  email: string;
}

async function leadIdsWhoClickedLinks(venueId: string, linkIds: string[]): Promise<Set<string>> {
  if (linkIds.length === 0) return new Set();
  const { data: rows } = await everyRow<{ lead_id: string | null }>((from, to) => supabaseAdmin
    .from('lead_marketing_events')
    .select('lead_id')
    .eq('venue_id', venueId)
    .eq('event_type', 'trigger_link_click')
    .in('trigger_link_id', linkIds)
    .order('id', { ascending: true })
    .range(from, to));
  const s = new Set<string>();
  for (const r of rows) {
    const id = (r as { lead_id: string | null }).lead_id;
    if (id) s.add(id);
  }
  return s;
}

function applyBehaviorFilters(
  rows: Array<{
    id: string;
    email: string | null;
    stage_id?: string | null;
    wedding_date?: string | null;
    marketing_email_opt_in?: boolean | null;
  }>,
  segment: CampaignSegment | SavedSegmentDefinition,
  suppressed: Set<string>,
  clickedSet: Set<string>,
): LeadRecipient[] {
  let list = rows.filter(
    (l) =>
      l.email &&
      !suppressed.has(l.id) &&
      (l.marketing_email_opt_in === undefined || l.marketing_email_opt_in !== false),
  );

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

/** Merge a campaign-level segment (which may be a `saved_segment` reference)
 * with the linked saved segment's own definition. Behavior filters set on
 * the campaign override / extend the saved segment's filters; the audience
 * type (all_leads / tags_any / stages) always comes from the saved segment.
 *
 * If `saved_segment_id` doesn't resolve (deleted or wrong venue), this
 * returns `null` so the caller can short-circuit to zero recipients.
 */
async function resolveSavedSegment(
  venueId: string,
  segment: CampaignSegment,
): Promise<CampaignSegment | null> {
  if (segment.type !== 'saved_segment') return segment;
  const id = segment.saved_segment_id?.trim();
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from('marketing_segments')
    .select('definition_json')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error || !data) return null;
  const base = parseSavedSegmentDefinition((data as { definition_json: unknown }).definition_json);
  return {
    ...base,
    exclude_stage_ids: dedupe([...(base.exclude_stage_ids ?? []), ...(segment.exclude_stage_ids ?? [])]),
    require_wedding_date: base.require_wedding_date || segment.require_wedding_date,
    clicked_trigger_link_ids: dedupe([
      ...(base.clicked_trigger_link_ids ?? []),
      ...(segment.clicked_trigger_link_ids ?? []),
    ]),
    require_not_booked: base.require_not_booked || segment.require_not_booked,
    booked_stage_ids: dedupe([...(base.booked_stage_ids ?? []), ...(segment.booked_stage_ids ?? [])]),
  };
}

function dedupe<T>(arr: T[]): T[] | undefined {
  if (!arr.length) return undefined;
  return Array.from(new Set(arr));
}

/**
 * Who a campaign goes to.
 *
 * Every list here is read to its end (lib/in-batches). Until Oct 7 2026 each
 * was one request: the database answers with 1,000 rows at most, so "all
 * leads" at a venue with more reached the first thousand and said nothing;
 * and a list of ids past about 430 was too long to send at all, so a tag
 * held by more leads than that gave an audience of nobody.
 *
 * A list that can't be read gives an audience of nobody, never a partial
 * one: sending to some of the people chosen, or past an unsubscribe list
 * that didn't load, is worse than not sending. (Each email is checked
 * against the unsubscribe list again as it is sent.)
 */
export async function resolveCampaignRecipients(
  venueId: string,
  segment: CampaignSegment,
): Promise<LeadRecipient[]> {
  const effective = await resolveSavedSegment(venueId, segment);
  if (!effective) return [];

  const suppressed = new Set<string>();
  const { data: sup, error: supErr } = await everyRow<{ lead_id: string }>((from, to) => supabaseAdmin
    .from('marketing_email_suppressions')
    .select('lead_id')
    .eq('venue_id', venueId)
    .order('lead_id', { ascending: true })
    .range(from, to));
  if (supErr) return [];
  for (const r of sup) suppressed.add(r.lead_id);

  const clk = effective.clicked_trigger_link_ids?.filter(Boolean) ?? [];
  const clickedSet =
    clk.length > 0 ? await leadIdsWhoClickedLinks(venueId, clk) : new Set<string>();

  const selectCols = 'id, email, stage_id, wedding_date, marketing_email_opt_in';

  if (effective.type === 'specific_contacts') {
    const emails = (effective.contact_emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (emails.length === 0) return [];
    const { data: leads, error } = await askInBatches<Record<string, unknown>>(emails, (batch) => supabaseAdmin
      .from('leads')
      .select(selectCols)
      .eq('venue_id', venueId)
      .in('email', batch), 50);
    if (error) return [];
    return applyBehaviorFilters(
      leads as Array<{ id: string; email: string | null; stage_id: string | null; wedding_date: string | null; marketing_email_opt_in: boolean | null }>,
      effective,
      suppressed,
      clickedSet,
    );
  }

  if (effective.type === 'tags_any' && (effective.tag_ids?.length ?? 0) > 0) {
    const { data: rows, error } = await everyRow<{ lead_id: string }>((from, to) => supabaseAdmin
      .from('lead_tag_assignments')
      .select('lead_id')
      .eq('venue_id', venueId)
      .in('tag_id', effective.tag_ids!)
      .order('lead_id', { ascending: true })
      .order('tag_id', { ascending: true })
      .range(from, to));
    if (error || !rows.length) return [];
    const ids = [...new Set(rows.map((r) => r.lead_id))];
    const { data: leads, error: le } = await askInBatches<Record<string, unknown>>(ids, (batch) => supabaseAdmin
      .from('leads')
      .select(selectCols)
      .eq('venue_id', venueId)
      .in('id', batch));
    if (le) return [];
    return applyBehaviorFilters(
      leads as Array<{ id: string; email: string | null; stage_id: string | null; wedding_date: string | null }>,
      effective,
      suppressed,
      clickedSet,
    );
  }

  if (effective.type === 'stages' && (effective.stage_ids?.length ?? 0) > 0) {
    const { data: leads, error } = await everyRow<Record<string, unknown>>((from, to) => supabaseAdmin
      .from('leads')
      .select(selectCols)
      .eq('venue_id', venueId)
      .in('stage_id', effective.stage_ids!)
      .order('id', { ascending: true })
      .range(from, to));
    if (error) return [];
    return applyBehaviorFilters(
      leads as Array<{ id: string; email: string | null; stage_id: string | null; wedding_date: string | null }>,
      effective,
      suppressed,
      clickedSet,
    );
  }

  const { data: leads, error } = await everyRow<Record<string, unknown>>((from, to) => supabaseAdmin
    .from('leads')
    .select(selectCols)
    .eq('venue_id', venueId)
    .order('id', { ascending: true })
    .range(from, to));
  if (error) return [];
  return applyBehaviorFilters(
    leads as Array<{ id: string; email: string | null; stage_id: string | null; wedding_date: string | null }>,
    effective,
    suppressed,
    clickedSet,
  );
}

/** Lightweight count helper for the segment preview UI. Same logic as
 * `resolveCampaignRecipients` but only returns the recipient count. */
export async function countCampaignRecipients(venueId: string, segment: CampaignSegment): Promise<number> {
  const list = await resolveCampaignRecipients(venueId, segment);
  return list.length;
}
