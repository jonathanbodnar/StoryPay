import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows, error: wErr } = await supabaseAdmin
    .from('couple_saved_venues')
    .select('venue_id, created_at')
    .eq('couple_id', user.id)
    .order('created_at', { ascending: false });

  if (wErr) {
    console.error('[couple/wishlist GET]', wErr);
    return NextResponse.json({ error: wErr.message }, { status: 500 });
  }

  if (!rows?.length) return NextResponse.json({ items: [] });

  const ids = rows.map((r) => r.venue_id as string);
  const { data: venues, error: vErr } = await supabaseAdmin
    .from('venues')
    .select('id, slug, name, cover_image_url, location_city, location_state, is_published')
    .in('id', ids);

  if (vErr) {
    console.error('[couple/wishlist venues]', vErr);
    return NextResponse.json({ error: vErr.message }, { status: 500 });
  }

  const map = new Map((venues ?? []).map((v) => [v.id as string, v]));
  const items = rows
    .map((r) => {
      const v = map.get(r.venue_id as string);
      if (!v) return null;
      return {
        saved_at: r.created_at as string,
        venue: {
          id: v.id,
          slug: v.slug,
          name: v.name,
          cover_image_url: v.cover_image_url,
          location_city: v.location_city,
          location_state: v.location_state,
          is_published: v.is_published,
        },
      };
    })
    .filter(Boolean);

  return NextResponse.json({ items });
}

/**
 * POST /api/couple/wishlist
 *
 * Body:
 *   { slug: string, action?: 'add' | 'remove' | 'toggle' }
 *
 * Default action is 'add' (back-compat). When action='toggle', the result
 * tells the caller which state the venue ended up in via `saved: boolean`.
 */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { slug?: string; action?: 'add' | 'remove' | 'toggle' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const slug = (body.slug ?? '').trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  const action = body.action ?? 'add';

  const { data: venue, error: vErr } = await supabaseAdmin
    .from('venues')
    .select('id, is_published')
    .eq('slug', slug)
    .maybeSingle();

  if (vErr || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }
  if (!venue.is_published && action !== 'remove') {
    return NextResponse.json({ error: 'That venue is not listed publicly.' }, { status: 400 });
  }

  const venueId = venue.id as string;

  // Determine current state for toggle action
  let isSaved = false;
  if (action === 'toggle' || action === 'remove') {
    const { data: existing } = await supabaseAdmin
      .from('couple_saved_venues')
      .select('venue_id')
      .eq('couple_id', user.id)
      .eq('venue_id', venueId)
      .maybeSingle();
    isSaved = Boolean(existing);
  }

  const shouldRemove = action === 'remove' || (action === 'toggle' && isSaved);

  if (shouldRemove) {
    const { error: delErr } = await supabaseAdmin
      .from('couple_saved_venues')
      .delete()
      .eq('couple_id', user.id)
      .eq('venue_id', venueId);
    if (delErr) {
      console.error('[couple/wishlist POST remove]', delErr);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, venue_id: venueId, saved: false });
  }

  // Add (or no-op if already there)
  const { error: insErr } = await supabaseAdmin.from('couple_saved_venues').insert({
    couple_id: user.id,
    venue_id: venueId,
  });

  if (insErr && !/duplicate key|unique constraint/i.test(insErr.message)) {
    console.error('[couple/wishlist POST]', insErr);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, venue_id: venueId, saved: true });
}
