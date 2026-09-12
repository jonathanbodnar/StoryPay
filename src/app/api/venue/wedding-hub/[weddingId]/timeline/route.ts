import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { sanitizeTimeline, type WeddingTimeline } from '@/lib/wedding-timeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Confirm the wedding link belongs to this venue and is actively linked. */
async function assertVenueWedding(weddingId: string, venueId: string): Promise<{ timeline: WeddingTimeline } | null> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('id, venue_id, status, timeline')
    .eq('id', weddingId)
    .eq('venue_id', venueId)
    .maybeSingle();
  const row = data as { status?: string; timeline?: unknown } | null;
  if (!row || row.status !== 'linked') return null;
  return { timeline: sanitizeTimeline(row.timeline) };
}

/** GET — the day-of timeline for a connected couple (venue side). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { weddingId } = await params;

  const found = await assertVenueWedding(weddingId, venueId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ timeline: found.timeline });
}

/** PUT — the venue edits the shared timeline. Optimistic concurrency via rev. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { weddingId } = await params;

  const found = await assertVenueWedding(weddingId, venueId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { timeline?: unknown };
  try {
    body = (await request.json()) as { timeline?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = sanitizeTimeline(body.timeline);
  const current = found.timeline;

  if (incoming.rev !== current.rev) {
    return NextResponse.json({ error: 'stale', timeline: current }, { status: 409 });
  }

  const next: WeddingTimeline = { rev: current.rev + 1, events: incoming.events };
  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ timeline: next })
    .eq('id', weddingId);
  if (error) {
    console.error('[venue/timeline PUT]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, timeline: next });
}
