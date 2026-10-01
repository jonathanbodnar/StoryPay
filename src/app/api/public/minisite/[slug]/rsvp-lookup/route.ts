import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMinisiteSignature } from '@/lib/minisite-webhook';
import { minisiteUnlockToken } from '@/lib/couple-sites';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST — public "find your invitation by name" for a couple's minisite.
 * HMAC-signed by the weddingdirectory proxy. Returns matching guest parties with
 * their private rsvp_token so the guest can complete the RSVP form. Requires a
 * published site linked to a wedding.
 *
 * A guest gives their first and last name, and only parties whose name holds
 * every one of those words come back, so the guest list can't be read out by
 * trying a few letters at a time. A password-protected site also needs the
 * unlock token (body.k), the same one its pages use.
 */
function nameWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rawBody = await req.text();
  if (!verifyMinisiteSignature(rawBody, req.headers.get('x-storypay-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: { name?: unknown; k?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // The directory calls on every guest's behalf, so the limit is per site.
  if (!rateLimit(`rsvp-lookup:${slug}`, 120, 60 * 60 * 1000).allowed) {
    return NextResponse.json({ error: 'Too many lookups right now. Please try again in a little while.' }, { status: 429 });
  }

  const name = String(body.name ?? '').trim();
  const words = nameWords(name).filter((w) => w.length >= 2);
  if (words.length < 2) {
    return NextResponse.json({ error: 'Enter your first and last name to find your invitation.' }, { status: 400 });
  }

  const { data: siteRow } = await supabaseAdmin
    .from('couple_sites')
    .select('couple_id, site_password_hash')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  const site = siteRow as { couple_id?: string; site_password_hash?: string | null } | null;
  const coupleId = site?.couple_id;
  if (!coupleId) return NextResponse.json({ matches: [] });
  if (site?.site_password_hash) {
    const k = typeof body.k === 'string' ? body.k : '';
    if (k !== minisiteUnlockToken(slug, site.site_password_hash)) {
      return NextResponse.json({ error: 'This wedding website is private.' }, { status: 403 });
    }
  }

  const { data: wedding } = await supabaseAdmin
    .from('couple_weddings')
    .select('id')
    .eq('couple_id', coupleId)
    .in('status', ['linked', 'pending', 'self'])
    .order('status', { ascending: true })
    .limit(1)
    .maybeSingle();
  const weddingId = (wedding as { id?: string } | null)?.id;
  if (!weddingId) return NextResponse.json({ matches: [] });

  // Candidates contain the longest word; a match holds every word the guest gave.
  const longest = words.slice().sort((a, b) => b.length - a.length)[0];
  const escaped = longest.replace(/[%_,\\]/g, (m) => `\\${m}`);
  const { data: candidates } = await supabaseAdmin
    .from('wedding_guests')
    .select('id, full_name, party_size, guest_group, rsvp_status, rsvp_token')
    .eq('couple_wedding_id', weddingId)
    .ilike('full_name', `%${escaped}%`)
    .order('full_name', { ascending: true })
    .limit(100);
  const guests = ((candidates ?? []) as Array<Record<string, unknown>>)
    .filter((g) => {
      const have = new Set(nameWords(String(g.full_name ?? '')));
      return words.every((w) => have.has(w));
    })
    .slice(0, 5);

  const matches = guests.map((g) => ({
    token: g.rsvp_token as string,
    fullName: g.full_name as string,
    partySize: (g.party_size as number) ?? 1,
    group: (g.guest_group as string | null) ?? null,
    rsvpStatus: (g.rsvp_status as string) ?? 'pending',
  }));

  return NextResponse.json({ matches });
}
