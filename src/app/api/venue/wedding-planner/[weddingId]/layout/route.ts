import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { sanitizeLayout, type WeddingLayout } from '@/lib/wedding-layout';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Confirm the wedding link belongs to this venue and is actively linked. */
async function assertVenueWedding(weddingId: string, venueId: string): Promise<{ layout: WeddingLayout } | null> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('id, venue_id, status, layout')
    .eq('id', weddingId)
    .eq('venue_id', venueId)
    .maybeSingle();
  const row = data as { status?: string; layout?: unknown } | null;
  if (!row || row.status !== 'linked') return null;
  return { layout: sanitizeLayout(row.layout) };
}

/** GET — the room layout for a connected couple (venue side). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { weddingId } = await params;

  const found = await assertVenueWedding(weddingId, venueId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ layout: found.layout });
}

/** PUT — the venue edits the shared layout. Optimistic concurrency via rev. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { weddingId } = await params;

  const found = await assertVenueWedding(weddingId, venueId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { layout?: unknown };
  try {
    body = (await request.json()) as { layout?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = sanitizeLayout(body.layout);
  const current = found.layout;

  if (incoming.rev !== current.rev) {
    return NextResponse.json({ error: 'stale', layout: current }, { status: 409 });
  }

  const next: WeddingLayout = { rev: current.rev + 1, elements: incoming.elements };
  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ layout: next })
    .eq('id', weddingId);
  if (error) {
    console.error('[venue/layout PUT]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, layout: next });
}
