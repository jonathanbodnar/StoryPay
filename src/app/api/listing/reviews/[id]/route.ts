import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (typeof body.status === 'string') {
    if (!['pending', 'published', 'hidden'].includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    updates.status = body.status;
  }

  if (typeof body.title === 'string') updates.title = body.title.trim() || null;
  if (typeof body.body === 'string') {
    const t = body.body.trim();
    if (!t) return NextResponse.json({ error: 'body cannot be empty' }, { status: 400 });
    updates.body = t;
  }
  if (typeof body.reviewer_name === 'string') {
    const t = body.reviewer_name.trim();
    if (!t) return NextResponse.json({ error: 'reviewer_name cannot be empty' }, { status: 400 });
    updates.reviewer_name = t;
  }
  if (body.reviewer_email === null || body.reviewer_email === '') {
    updates.reviewer_email = null;
  } else if (typeof body.reviewer_email === 'string') {
    updates.reviewer_email = body.reviewer_email.trim().toLowerCase() || null;
  }
  if (body.wedding_date === null || body.wedding_date === '') {
    updates.wedding_date = null;
  } else if (typeof body.wedding_date === 'string') {
    updates.wedding_date = body.wedding_date.trim() || null;
  }
  if (body.rating !== undefined) {
    const r = Number(body.rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return NextResponse.json({ error: 'rating must be 1–5' }, { status: 400 });
    }
    updates.rating = r;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('listing_reviews')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[listing/reviews PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { error } = await supabaseAdmin
    .from('listing_reviews')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) {
    console.error('[listing/reviews DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
