import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const statusFilter = request.nextUrl.searchParams.get('status');
  let q = supabaseAdmin
    .from('listing_reviews')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (statusFilter === 'pending' || statusFilter === 'published' || statusFilter === 'hidden') {
    q = q.eq('status', statusFilter);
  }

  const { data, error } = await q;
  if (error) {
    console.error('[listing/reviews GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'rating must be an integer 1–5' }, { status: 400 });
  }

  const rawBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!rawBody) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }

  const reviewer_name =
    typeof body.reviewer_name === 'string' ? body.reviewer_name.trim() : '';
  if (!reviewer_name) {
    return NextResponse.json({ error: 'reviewer_name is required' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : null;
  const reviewer_email =
    typeof body.reviewer_email === 'string' && body.reviewer_email.trim()
      ? body.reviewer_email.trim().toLowerCase()
      : null;
  const wedding_date =
    typeof body.wedding_date === 'string' && body.wedding_date.trim()
      ? body.wedding_date.trim()
      : null;

  let status: 'pending' | 'published' | 'hidden' = 'published';
  if (body.status === 'pending' || body.status === 'published' || body.status === 'hidden') {
    status = body.status;
  }

  const { data: row, error } = await supabaseAdmin
    .from('listing_reviews')
    .insert({
      venue_id: venueId,
      rating,
      title: title || null,
      body: rawBody,
      reviewer_name,
      reviewer_email,
      wedding_date,
      status,
      source: 'venue_dashboard',
    })
    .select('*')
    .single();

  if (error) {
    console.error('[listing/reviews POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(row, { status: 201 });
}
