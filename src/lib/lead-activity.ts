import { supabaseAdmin } from '@/lib/supabase';

export type LeadActivityAction =
  | 'stage_changed'
  | 'value_changed'
  | 'assigned_changed'
  | 'call_logged'
  | 'note_added';

export async function insertLeadActivity(params: {
  venueId: string;
  leadId: string;
  actorMemberId: string | null;
  actorIsOwner: boolean;
  action: LeadActivityAction;
  details: Record<string, unknown>;
}) {
  const { error } = await supabaseAdmin.from('lead_activity_log').insert({
    venue_id: params.venueId,
    lead_id: params.leadId,
    actor_member_id: params.actorMemberId,
    actor_is_owner: params.actorIsOwner,
    action: params.action,
    details: params.details,
  });
  if (error) console.error('[insertLeadActivity]', error.message);
}

export async function fetchLeadActivity(venueId: string, leadId: string, limit = 50) {
  const { data, error } = await supabaseAdmin
    .from('lead_activity_log')
    .select('id, actor_member_id, actor_is_owner, action, details, created_at')
    .eq('venue_id', venueId)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[fetchLeadActivity]', error.message);
    return [];
  }
  return data ?? [];
}
