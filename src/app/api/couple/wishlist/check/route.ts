import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/couple/wishlist/check?slug=...
 *
 * Returns `{ saved: boolean, signed_in: boolean }` so the wishlist
 * button can render the correct initial state without round-tripping
 * through the user's full wishlist.
 *
 * Returns `signed_in: false` (not 401) when no auth header so the
 * button can render the "Save" state without surfacing an error.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const slug = (url.searchParams.get('slug') ?? '').trim().toLowerCase();
  if (!slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  }

  const user = await getCoupleAuthUser(request);
  if (!user) {
    return NextResponse.json({ saved: false, signed_in: false });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (!venue) {
    return NextResponse.json({ saved: false, signed_in: true });
  }

  const { data: existing } = await supabaseAdmin
    .from('couple_saved_venues')
    .select('venue_id')
    .eq('couple_id', user.id)
    .eq('venue_id', venue.id as string)
    .maybeSingle();

  return NextResponse.json({ saved: Boolean(existing), signed_in: true });
}
