import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Fetch current state
  const [{ data: existing }, { data: req }] = await Promise.all([
    supabaseAdmin
      .from('feature_request_votes')
      .select('request_id')
      .eq('request_id', id)
      .eq('venue_id', venueId)
      .maybeSingle(),
    supabaseAdmin
      .from('feature_requests')
      .select('vote_count')
      .eq('id', id)
      .single(),
  ]);

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (existing) {
    // Remove vote (toggle off)
    await supabaseAdmin
      .from('feature_request_votes')
      .delete()
      .eq('request_id', id)
      .eq('venue_id', venueId);

    const newCount = Math.max(0, (req.vote_count ?? 1) - 1);
    await supabaseAdmin.from('feature_requests').update({ vote_count: newCount }).eq('id', id);
    return NextResponse.json({ voted: false, vote_count: newCount });
  }

  // Add vote
  const { error: insertError } = await supabaseAdmin
    .from('feature_request_votes')
    .insert({ request_id: id, venue_id: venueId });

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 });

  const newCount = (req.vote_count ?? 0) + 1;
  await supabaseAdmin.from('feature_requests').update({ vote_count: newCount }).eq('id', id);
  return NextResponse.json({ voted: true, vote_count: newCount });
}
