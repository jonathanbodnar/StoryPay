/**
 * "Typically replies in ~X" SLA badge for the Venue Concierge channel.
 *
 * Computed from historical response latency: for each venue message that was
 * followed by a concierge reply, measure the gap to that first reply, then take
 * the median across the most recent pairs. Median (not mean) so one slow reply
 * over a weekend doesn't skew the promise. Falls back to a platform-wide number
 * when a venue has too little history, and to a friendly default otherwise.
 */

import { supabaseAdmin } from '@/lib/supabase';

const MIN_PAIRS = 3;
const LOOKBACK = 400;

function formatDuration(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `~${mins} min`;
  const hours = mins / 60;
  if (hours < 24) return `~${Math.round(hours)} hr`;
  const days = Math.round(hours / 24);
  return `~${days} day${days === 1 ? '' : 's'}`;
}

/** Median first-response latency (ms) from a chronological message list. */
function medianLatencyMs(
  rows: Array<{ sender_kind: string; created_at: string }>,
): number | null {
  const gaps: number[] = [];
  let pendingVenueAt: number | null = null;
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (r.sender_kind === 'venue') {
      if (pendingVenueAt === null) pendingVenueAt = t;
    } else if (r.sender_kind === 'concierge' && pendingVenueAt !== null) {
      const gap = t - pendingVenueAt;
      if (gap > 0) gaps.push(gap);
      pendingVenueAt = null;
    }
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}

export interface ConciergeSla {
  /** e.g. "~2 hr" — null when there's no signal at all. */
  label: string | null;
  /** How many venue→concierge reply pairs backed the number. */
  samples: number;
}

export async function computeConciergeSla(venueId: string): Promise<ConciergeSla> {
  // Per-venue history first.
  const { data: own } = await supabaseAdmin
    .from('venue_concierge_messages')
    .select('sender_kind, created_at')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true })
    .limit(LOOKBACK);
  const ownRows = (own ?? []) as Array<{ sender_kind: string; created_at: string }>;

  const ownPairs = ownRows.filter((r) => r.sender_kind === 'venue').length;
  const ownMedian = medianLatencyMs(ownRows);
  if (ownMedian !== null && ownPairs >= MIN_PAIRS) {
    return { label: formatDuration(ownMedian), samples: ownPairs };
  }

  // Fall back to a platform-wide median so brand-new threads still show a promise.
  const { data: all } = await supabaseAdmin
    .from('venue_concierge_messages')
    .select('venue_id, sender_kind, created_at')
    .order('created_at', { ascending: true })
    .limit(4000);
  const byVenue = new Map<string, Array<{ sender_kind: string; created_at: string }>>();
  for (const r of (all ?? []) as Array<{ venue_id: string; sender_kind: string; created_at: string }>) {
    const arr = byVenue.get(r.venue_id) ?? [];
    arr.push({ sender_kind: r.sender_kind, created_at: r.created_at });
    byVenue.set(r.venue_id, arr);
  }
  const medians: number[] = [];
  for (const arr of byVenue.values()) {
    const m = medianLatencyMs(arr);
    if (m !== null) medians.push(m);
  }
  if (medians.length > 0) {
    medians.sort((a, b) => a - b);
    const mid = Math.floor(medians.length / 2);
    const platform = medians.length % 2 ? medians[mid] : Math.round((medians[mid - 1] + medians[mid]) / 2);
    return { label: formatDuration(platform), samples: 0 };
  }

  return { label: null, samples: 0 };
}
