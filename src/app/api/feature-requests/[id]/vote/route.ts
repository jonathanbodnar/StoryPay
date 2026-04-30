import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // ── Fast path: RPC ────────────────────────────────────────────────────────
  const { data, error } = await supabaseAdmin.rpc('toggle_feature_vote', {
    p_request_id: id,
    p_venue_id: venueId,
  });

  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ voted: row.voted, vote_count: row.vote_count });
  }

  // ── Fallback: direct SQL (RPC not deployed yet) ────────────────────────────
  console.warn('[vote] RPC unavailable, using direct SQL fallback:', error.message);

  try {
    // Check if this venue has already voted
    const { data: existing } = await supabaseAdmin
      .from('feature_request_votes')
      .select('id')
      .eq('request_id', id)
      .eq('venue_id', venueId)
      .maybeSingle();

    // Get current vote count
    const { data: cur } = await supabaseAdmin
      .from('feature_requests')
      .select('vote_count')
      .eq('id', id)
      .single();

    const currentCount = (cur?.vote_count as number) ?? 0;

    if (existing) {
      // Remove vote
      await supabaseAdmin
        .from('feature_request_votes')
        .delete()
        .eq('request_id', id)
        .eq('venue_id', venueId);

      const newCount = Math.max(0, currentCount - 1);
      await supabaseAdmin
        .from('feature_requests')
        .update({ vote_count: newCount })
        .eq('id', id);

      return NextResponse.json({ voted: false, vote_count: newCount });
    } else {
      // Add vote (ignore conflict in case of race)
      await supabaseAdmin
        .from('feature_request_votes')
        .upsert({ request_id: id, venue_id: venueId }, { onConflict: 'request_id,venue_id', ignoreDuplicates: true });

      const newCount = currentCount + 1;
      await supabaseAdmin
        .from('feature_requests')
        .update({ vote_count: newCount })
        .eq('id', id);

      return NextResponse.json({ voted: true, vote_count: newCount });
    }
  } catch (fallbackErr) {
    console.error('[vote] fallback error:', fallbackErr);
    return NextResponse.json({ error: 'Failed to record vote. Please try again.' }, { status: 500 });
  }
}
