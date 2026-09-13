import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { sanitizeInspiration, type WeddingInspiration } from '@/lib/wedding-inspiration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Confirm the wedding link belongs to this venue and is actively linked. */
async function assertVenueWedding(weddingId: string, venueId: string): Promise<{ inspiration: WeddingInspiration } | null> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('id, venue_id, status, inspiration')
    .eq('id', weddingId)
    .eq('venue_id', venueId)
    .maybeSingle();
  const row = data as { status?: string; inspiration?: unknown } | null;
  if (!row || row.status !== 'linked') return null;
  return { inspiration: sanitizeInspiration(row.inspiration) };
}

/** GET — the inspiration board for a connected couple (venue side). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { weddingId } = await params;

  const found = await assertVenueWedding(weddingId, venueId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ inspiration: found.inspiration });
}

/** PUT — the venue edits the shared board. Optimistic concurrency via rev. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { weddingId } = await params;

  const found = await assertVenueWedding(weddingId, venueId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { inspiration?: unknown };
  try {
    body = (await request.json()) as { inspiration?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = sanitizeInspiration(body.inspiration);
  const current = found.inspiration;

  if (incoming.rev !== current.rev) {
    return NextResponse.json({ error: 'stale', inspiration: current }, { status: 409 });
  }

  const next: WeddingInspiration = { rev: current.rev + 1, items: incoming.items };
  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ inspiration: next })
    .eq('id', weddingId);
  if (error) {
    console.error('[venue/inspiration PUT]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inspiration: next });
}
