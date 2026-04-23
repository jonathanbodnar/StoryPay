import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Returns completed feature requests that are relevant to the calling venue:
 * - Requests the venue submitted (is_mine)
 * - Requests the venue voted on (has_voted)
 * Sorted newest-completed first.
 */
export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch completed requests submitted by this venue.
  const { data: mine, error: mineErr } = await supabaseAdmin
    .from('feature_requests')
    .select('id, title, description, vote_count, status, created_at, completed_at, changelog_id')
    .eq('status', 'completed')
    .eq('venue_id', venueId)
    .order('completed_at', { ascending: false, nullsFirst: false });

  if (mineErr && /completed_at|changelog_id/i.test(mineErr.message)) {
    // Column missing — fall back to base columns.
    const { data: plain } = await supabaseAdmin
      .from('feature_requests')
      .select('id, title, description, vote_count, status, created_at')
      .eq('status', 'completed')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false });

    return NextResponse.json(
      (plain ?? []).map((r) => ({
        ...r,
        completed_at: null,
        changelog_id: null,
        is_mine: true,
        has_voted: false,
      })),
    );
  }

  // Fetch completed requests the venue voted on (but didn't submit).
  const { data: voted } = await supabaseAdmin
    .from('feature_request_votes')
    .select('request_id')
    .eq('venue_id', venueId);

  const votedIds = (voted ?? []).map((v) => v.request_id as string);
  const mineIds = new Set((mine ?? []).map((r) => r.id as string));

  // Only fetch voted ones that aren't already in the "mine" list.
  const otherVotedIds = votedIds.filter((id) => !mineIds.has(id));

  let votedCompleted: typeof mine = [];
  if (otherVotedIds.length > 0) {
    const { data: vc } = await supabaseAdmin
      .from('feature_requests')
      .select('id, title, description, vote_count, status, created_at, completed_at, changelog_id')
      .eq('status', 'completed')
      .in('id', otherVotedIds)
      .order('completed_at', { ascending: false, nullsFirst: false });
    votedCompleted = vc ?? [];
  }

  const mineRows = (mine ?? []).map((r) => ({
    ...r,
    is_mine: true,
    has_voted: true,
  }));

  const votedRows = votedCompleted.map((r) => ({
    ...r,
    is_mine: false,
    has_voted: true,
  }));

  return NextResponse.json([...mineRows, ...votedRows]);
}
