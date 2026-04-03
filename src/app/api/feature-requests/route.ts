import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: requests, error } = await supabaseAdmin
    .from('feature_requests')
    .select('*')
    .order('vote_count', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch which ones this venue has already voted on
  const ids = (requests ?? []).map((r) => r.id);
  let votedSet = new Set<string>();
  if (ids.length > 0) {
    const { data: votes } = await supabaseAdmin
      .from('feature_request_votes')
      .select('request_id')
      .eq('venue_id', venueId)
      .in('request_id', ids);
    votedSet = new Set((votes ?? []).map((v) => v.request_id));
  }

  const result = (requests ?? []).map((r) => ({
    ...r,
    has_voted: votedSet.has(r.id),
  }));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { title, description } = await request.json();
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('feature_requests')
    .insert({ venue_id: venueId, title: title.trim(), description: description?.trim() || null, vote_count: 1 })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-vote for own submission
  await supabaseAdmin
    .from('feature_request_votes')
    .insert({ request_id: data.id, venue_id: venueId })
    .then(() => {});

  return NextResponse.json({ ...data, has_voted: true }, { status: 201 });
}
