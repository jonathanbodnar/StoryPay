/**
 * GET /api/listing/booking-system/lead-sources
 *
 * The lead-source slice + LeadFinder™ summary for the Speed-to-Lead page.
 *
 * The breakdown is tallied straight off `leads.source` — the column every
 * capture path writes (the StoryVenue directory, the embedded web form, manual
 * entry, LeadFinder's forwarded email, imports, …). Reading the actual values
 * present, rather than a hard-coded enum, means a new entry point shows up as
 * its own slice the moment it writes its first lead. Labels come from
 * `leadSourceLabel` (shared with the leads list), and rows with no source land
 * in a single "Other" bucket instead of being dropped.
 *
 * Read-only. Scoped to the signed-in venue, resolved exactly like the sibling
 * booking-system endpoints.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { LEADFINDER_SOURCE, leadSourceLabel } from '@/lib/lead-source';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

export interface LeadSourceSlice {
  /** Raw `leads.source` value (lowercased); '' for rows with none set. */
  key:    string;
  label:  string;
  count:  number;
  /** Integer share of the venue's leads, 0-100. */
  share:  number;
}

export interface LeadFinderSummary {
  /** Leads LeadFinder has captured for this venue (`leads.source='leadfinder'`). */
  captured:       number;
  /** When it last captured one, or null when it never has. */
  lastCapturedAt: string | null;
}

export interface LeadSourcesPayload {
  total:     number;
  sources:   LeadSourceSlice[];
  leadfinder: LeadFinderSummary;
}

// Paginate past PostgREST's 1000-row cap so the tally covers every lead rather
// than an arbitrary first page (same reason the funnel route pages).
const PAGE     = 1000;
const MAX_ROWS = 200_000;

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const counts = new Map<string, number>();
  let total = 0;

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('source')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error || !data?.length) break;
    for (const row of data as Array<{ source: string | null }>) {
      const key = (row.source ?? '').trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total += 1;
    }
    if (data.length < PAGE) break;
  }

  const sources: LeadSourceSlice[] = [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: leadSourceLabel(key),
      count,
      share: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const { data: lastLead } = await supabaseAdmin
    .from('leads')
    .select('created_at')
    .eq('venue_id', venueId)
    .eq('source', LEADFINDER_SOURCE)
    .order('created_at', { ascending: false })
    .limit(1);

  return NextResponse.json({
    total,
    sources,
    leadfinder: {
      // Same tally the slice is built from, so the card and the breakdown can
      // never disagree.
      captured: counts.get(LEADFINDER_SOURCE) ?? 0,
      lastCapturedAt: (lastLead?.[0]?.created_at as string | null) ?? null,
    },
  } satisfies LeadSourcesPayload);
}
