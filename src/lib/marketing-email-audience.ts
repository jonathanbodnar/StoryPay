import { supabaseAdmin } from '@/lib/supabase';
import type { CampaignSegment } from '@/lib/marketing-email-schema';

export interface LeadRecipient {
  id: string;
  email: string;
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
      .select('id, email')
      .eq('venue_id', venueId)
      .in('id', ids);
    if (le || !leads) return [];
    return (leads as Array<{ id: string; email: string | null }>)
      .filter((l) => l.email && !suppressed.has(l.id))
      .map((l) => ({ id: l.id, email: l.email!.trim() }));
  }

  if (segment.type === 'stages' && (segment.stage_ids?.length ?? 0) > 0) {
    const { data: leads, error } = await supabaseAdmin
      .from('leads')
      .select('id, email')
      .eq('venue_id', venueId)
      .in('stage_id', segment.stage_ids!);
    if (error || !leads) return [];
    return (leads as Array<{ id: string; email: string | null }>)
      .filter((l) => l.email && !suppressed.has(l.id))
      .map((l) => ({ id: l.id, email: l.email!.trim() }));
  }

  // all_leads
  const { data: leads, error } = await supabaseAdmin
    .from('leads')
    .select('id, email')
    .eq('venue_id', venueId);
  if (error || !leads) return [];
  return (leads as Array<{ id: string; email: string | null }>)
    .filter((l) => l.email && !suppressed.has(l.id))
    .map((l) => ({ id: l.id, email: l.email!.trim() }));
}
