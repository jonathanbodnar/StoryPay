import { supabaseAdmin } from '@/lib/supabase';
import type { StageEventSets } from '@/lib/funnel-stage';

/**
 * Server-only loader for the conversion funnel. Pulls authoritative venue
 * lifecycle state (excluding demos) plus the analytics-event membership sets
 * for the in-modal micro-steps, scoped to an optional signup date window.
 *
 * Shared by the aggregate funnel route and the "venues in this stage"
 * drill-down so both always agree.
 */

export interface FunnelVenueRow {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string | null;
  is_published: boolean | null;
  onboarding_last_step: number | null;
  onboarding_completed_at: string | null;
  onboarding_activated_at: string | null;
  directory_subscription_status: string | null;
  directory_subscription_external_id: string | null;
}

export interface FunnelData {
  venues: FunnelVenueRow[];
  evSets: StageEventSets;
}

export async function loadFunnelData(from?: string | null, to?: string | null): Promise<FunnelData> {
  const toEnd = to ? `${to}T23:59:59.999Z` : undefined;

  let venuesQuery = supabaseAdmin
    .from('venues')
    .select(
      'id, name, email, is_demo, created_at, is_published, onboarding_last_step, onboarding_completed_at, onboarding_activated_at, directory_subscription_status, directory_subscription_external_id',
    );
  if (from) venuesQuery = venuesQuery.gte('created_at', from);
  if (toEnd) venuesQuery = venuesQuery.lte('created_at', toEnd);
  const { data: venues } = await venuesQuery;

  const real = ((venues ?? []) as Record<string, unknown>[])
    .filter((v) => !v.is_demo)
    .map((v) => ({
      id: String(v.id),
      name: (v.name as string | null) ?? null,
      email: (v.email as string | null) ?? null,
      created_at: (v.created_at as string | null) ?? null,
      is_published: (v.is_published as boolean | null) ?? null,
      onboarding_last_step: (v.onboarding_last_step as number | null) ?? null,
      onboarding_completed_at: (v.onboarding_completed_at as string | null) ?? null,
      onboarding_activated_at: (v.onboarding_activated_at as string | null) ?? null,
      directory_subscription_status: (v.directory_subscription_status as string | null) ?? null,
      directory_subscription_external_id: (v.directory_subscription_external_id as string | null) ?? null,
    }));

  // Distinct-venue sets for the in-modal analytics micro-steps.
  const started = new Set<string>();
  const details = new Set<string>();
  const cardShown = new Set<string>();
  const { data: evRows } = await supabaseAdmin
    .from('analytics_events')
    .select('event, venue_id')
    .in('event', ['onboarding_started', 'onboarding_details_done', 'card_shown'])
    .not('venue_id', 'is', null);
  for (const r of (evRows ?? []) as { event: string; venue_id: string | null }[]) {
    if (!r.venue_id) continue;
    if (r.event === 'onboarding_started') started.add(r.venue_id);
    else if (r.event === 'onboarding_details_done') details.add(r.venue_id);
    else if (r.event === 'card_shown') cardShown.add(r.venue_id);
  }

  return { venues: real, evSets: { started, details, cardShown } };
}
