import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { sanitizeChecklist, type WeddingChecklist } from '@/lib/wedding-checklist';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Confirm the wedding link belongs to this venue and is actively linked. */
async function assertVenueWedding(weddingId: string, venueId: string): Promise<{ checklist: WeddingChecklist } | null> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('id, venue_id, status, checklist')
    .eq('id', weddingId)
    .eq('venue_id', venueId)
    .maybeSingle();
  const row = data as { status?: string; checklist?: unknown } | null;
  if (!row || row.status !== 'linked') return null;
  return { checklist: sanitizeChecklist(row.checklist) };
}

/** GET — the planning checklist for a connected couple (venue side). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { weddingId } = await params;

  const found = await assertVenueWedding(weddingId, venueId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ checklist: found.checklist });
}

/** PUT — the venue edits the shared checklist. Optimistic concurrency via rev. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { weddingId } = await params;

  const found = await assertVenueWedding(weddingId, venueId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { checklist?: unknown };
  try {
    body = (await request.json()) as { checklist?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = sanitizeChecklist(body.checklist);
  const current = found.checklist;

  if (incoming.rev !== current.rev) {
    return NextResponse.json({ error: 'stale', checklist: current }, { status: 409 });
  }

  const next: WeddingChecklist = { rev: current.rev + 1, items: incoming.items };
  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ checklist: next })
    .eq('id', weddingId);
  if (error) {
    console.error('[venue/checklist PUT]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, checklist: next });
}
