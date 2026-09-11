import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMinisiteSignature } from '@/lib/minisite-webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST — public "find your invitation by name" for a couple's minisite.
 * HMAC-signed by the weddingdirectory proxy. Returns matching guest parties with
 * their private rsvp_token so the guest can complete the RSVP form. Requires a
 * published site linked to a wedding.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rawBody = await req.text();
  if (!verifyMinisiteSignature(rawBody, req.headers.get('x-storypay-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: { name?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = String(body.name ?? '').trim();
  if (name.length < 2) {
    return NextResponse.json({ error: 'Enter your full name to find your invitation.' }, { status: 400 });
  }

  const { data: siteRow } = await supabaseAdmin
    .from('couple_sites')
    .select('couple_id')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  const coupleId = (siteRow as { couple_id?: string } | null)?.couple_id;
  if (!coupleId) return NextResponse.json({ matches: [] });

  const { data: wedding } = await supabaseAdmin
    .from('couple_weddings')
    .select('id')
    .eq('couple_id', coupleId)
    .eq('status', 'linked')
    .order('linked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const weddingId = (wedding as { id?: string } | null)?.id;
  if (!weddingId) return NextResponse.json({ matches: [] });

  // Case-insensitive contains match on the guest party name.
  const escaped = name.replace(/[%_,]/g, (m) => `\\${m}`);
  const { data: guests } = await supabaseAdmin
    .from('wedding_guests')
    .select('id, full_name, party_size, guest_group, rsvp_status, rsvp_token')
    .eq('couple_wedding_id', weddingId)
    .ilike('full_name', `%${escaped}%`)
    .order('full_name', { ascending: true })
    .limit(10);

  const matches = ((guests ?? []) as Array<Record<string, unknown>>).map((g) => ({
    token: g.rsvp_token as string,
    fullName: g.full_name as string,
    partySize: (g.party_size as number) ?? 1,
    group: (g.guest_group as string | null) ?? null,
    rsvpStatus: (g.rsvp_status as string) ?? 'pending',
  }));

  return NextResponse.json({ matches });
}
