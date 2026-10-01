import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMinisiteSignature } from '@/lib/minisite-webhook';
import { minisiteUnlockToken } from '@/lib/couple-sites';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SiteLite = { id: string; couple_id: string; show_guestbook: boolean; guestbook_moderated: boolean; site_password_hash: string | null };

async function loadPublishedSite(slug: string): Promise<SiteLite | null> {
  const { data } = await supabaseAdmin
    .from('couple_sites')
    .select('id, couple_id, show_guestbook, guestbook_moderated, site_password_hash')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  return (data as SiteLite | null) ?? null;
}

/**
 * GET — public wall of approved (non-hidden) well-wishes. A password-protected
 * site's wall needs its unlock token (?k=), the same one its pages use.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await loadPublishedSite(slug);
  if (!site || !site.show_guestbook) return NextResponse.json({ entries: [] });
  if (site.site_password_hash && req.nextUrl.searchParams.get('k') !== minisiteUnlockToken(slug, site.site_password_hash)) {
    return NextResponse.json({ entries: [], locked: true });
  }

  const { data } = await supabaseAdmin
    .from('couple_guestbook_entries')
    .select('id, guest_name, message, created_at')
    .eq('couple_site_id', site.id)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(200);

  return NextResponse.json({ entries: data ?? [] });
}

/** POST — leave a message. HMAC-signed by the weddingdirectory proxy. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rawBody = await req.text();
  if (!verifyMinisiteSignature(rawBody, req.headers.get('x-storypay-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: { guest_name?: unknown; message?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const guestName = String(body.guest_name ?? '').trim().slice(0, 80);
  const message = String(body.message ?? '').trim().slice(0, 1000);
  if (!guestName || !message) {
    return NextResponse.json({ error: 'Name and message are required.' }, { status: 400 });
  }

  const site = await loadPublishedSite(slug);
  if (!site || !site.show_guestbook) {
    return NextResponse.json({ error: 'Guestbook is not available.' }, { status: 404 });
  }
  if (!rateLimit(`guestbook-post:${site.id}`, 60, 60 * 60 * 1000).allowed) {
    return NextResponse.json({ error: 'The guestbook is busy. Please try again in a little while.' }, { status: 429 });
  }

  const { error } = await supabaseAdmin.from('couple_guestbook_entries').insert({
    couple_site_id: site.id,
    couple_id: site.couple_id,
    guest_name: guestName,
    message,
    // Moderated sites hold new posts for the couple to approve.
    is_hidden: site.guestbook_moderated,
  });
  if (error) {
    console.error('[minisite/guestbook POST]', error);
    return NextResponse.json({ error: 'Could not save your message.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, moderated: site.guestbook_moderated });
}
