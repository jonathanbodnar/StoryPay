import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { sanitizeVendors, type WeddingVendors } from '@/lib/wedding-vendors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Confirm the wedding link belongs to this venue and is actively linked. */
async function assertVenueWedding(weddingId: string, venueId: string): Promise<{ vendors: WeddingVendors } | null> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('id, venue_id, status, vendors')
    .eq('id', weddingId)
    .eq('venue_id', venueId)
    .maybeSingle();
  const row = data as { status?: string; vendors?: unknown } | null;
  if (!row || row.status !== 'linked') return null;
  return { vendors: sanitizeVendors(row.vendors) };
}

/** GET — the vendor directory for a connected couple (venue side). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { weddingId } = await params;

  const found = await assertVenueWedding(weddingId, venueId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ vendors: found.vendors });
}

/** PUT — the venue edits the shared vendor directory. Concurrency via rev. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { weddingId } = await params;

  const found = await assertVenueWedding(weddingId, venueId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { vendors?: unknown };
  try {
    body = (await request.json()) as { vendors?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = sanitizeVendors(body.vendors);
  const current = found.vendors;

  if (incoming.rev !== current.rev) {
    return NextResponse.json({ error: 'stale', vendors: current }, { status: 409 });
  }

  const next: WeddingVendors = { rev: current.rev + 1, items: incoming.items };
  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ vendors: next })
    .eq('id', weddingId);
  if (error) {
    console.error('[venue/vendors PUT]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, vendors: next });
}
