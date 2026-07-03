/**
 * Short guide link redirect — GET /g/[code]
 *
 * Resolves a venue's short guide code to the full guide page and performs
 * a 302 redirect, forwarding all query parameters (e.g. ?l= lead tracking).
 *
 * Short codes are stored in venues.guide_short_code and are generated from
 * the first 8 hex chars of the venue UUID.  They never change after creation
 * so any SMS or email containing a short link stays valid indefinitely.
 *
 * Example:
 *   /g/fcdca338?l=da4aaa92-bf92-440c-bbca-cb703a57b6d1
 *   → 302 → /guide/fcdca338-dcd8-4e33-8122-7b60209ae6ff?l=da4aaa92-...
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params;

  if (!code || !/^[a-z0-9]{1,12}$/i.test(code)) {
    return NextResponse.json({ error: 'Invalid short code' }, { status: 400 });
  }

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('guide_short_code', code.toLowerCase())
    .maybeSingle();

  if (error || !venue) {
    return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
  }

  // Build destination URL — preserve ALL incoming query params (lead ID, UTMs, etc.)
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || req.nextUrl.origin;
  const dest = new URL(`/guide/${venue.id}`, origin);

  req.nextUrl.searchParams.forEach((value, key) => {
    dest.searchParams.set(key, value);
  });

  return NextResponse.redirect(dest.toString(), { status: 302 });
}
