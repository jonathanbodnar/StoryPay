import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  isValidGooglePlaceId,
  parseGoogleReviewsCache,
  refreshVenueGoogleReviews,
} from '@/lib/venue-google-reviews';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * GET — current Google Place ID + cached reviews (for dashboard).
 */
export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const refresh = request.nextUrl.searchParams.get('refresh') === '1';

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('google_place_id, google_reviews_cache, google_reviews_fetched_at')
    .eq('id', venueId)
    .maybeSingle();

  if (error) {
    console.error('[GET /api/listing/google-reviews]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const row = data as {
    google_place_id: string | null;
    google_reviews_cache: unknown;
    google_reviews_fetched_at: string | null;
  };

  let cache = parseGoogleReviewsCache(row.google_reviews_cache);
  const pid = row.google_place_id?.trim() ?? '';

  if (pid && isValidGooglePlaceId(pid)) {
    // Auto-refresh when: explicitly requested, no cache yet, or cache is older than 24 h.
    const fetchedAt = row.google_reviews_fetched_at ? new Date(row.google_reviews_fetched_at) : null;
    const ageHours  = fetchedAt ? (Date.now() - fetchedAt.getTime()) / 3_600_000 : Infinity;
    const noCache   = !cache || !(cache as { reviews?: unknown[] }).reviews?.length;
    if (refresh || noCache || ageHours >= 24) {
      const fresh = await refreshVenueGoogleReviews(venueId, pid);
      if (fresh) cache = fresh;
    }
  }

  // Re-read fetched_at so auto-refresh above is reflected in the response.
  const { data: updated } = await supabaseAdmin
    .from('venues')
    .select('google_reviews_fetched_at')
    .eq('id', venueId)
    .maybeSingle();

  return NextResponse.json({
    google_place_id: pid || null,
    google_reviews_fetched_at: (updated as { google_reviews_fetched_at?: string | null } | null)?.google_reviews_fetched_at ?? row.google_reviews_fetched_at,
    cache,
  });
}

/**
 * PATCH — set or clear Google Place ID; optionally refresh cache immediately.
 * body: { google_place_id: string | null }
 */
export async function PATCH(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { google_place_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!('google_place_id' in body)) {
    return NextResponse.json({ error: 'google_place_id is required' }, { status: 400 });
  }

  const raw = body.google_place_id;
  let next: string | null = null;
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    next = null;
  } else if (typeof raw === 'string') {
    const t = raw.trim();
    if (!isValidGooglePlaceId(t)) {
      return NextResponse.json(
        {
          error:
            'Invalid Place ID. Paste the Google Maps Place ID for your business (often starts with ChIJ). Find it in Google Maps → your listing → Share → copy link, or use the Place ID tool in Google Cloud.',
        },
        { status: 400 },
      );
    }
    next = t;
  } else {
    return NextResponse.json({ error: 'google_place_id must be a string or null' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    google_place_id: next,
  };
  if (next === null) {
    updates.google_reviews_cache = null;
    updates.google_reviews_fetched_at = null;
  }

  const { error: upErr } = await supabaseAdmin.from('venues').update(updates).eq('id', venueId);
  if (upErr) {
    console.error('[PATCH /api/listing/google-reviews]', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  let cache = null as ReturnType<typeof parseGoogleReviewsCache>;
  if (next) {
    cache = await refreshVenueGoogleReviews(venueId, next);
  }

  const { data: again } = await supabaseAdmin
    .from('venues')
    .select('google_place_id, google_reviews_cache, google_reviews_fetched_at')
    .eq('id', venueId)
    .maybeSingle();

  const r2 = again as {
    google_place_id: string | null;
    google_reviews_cache: unknown;
    google_reviews_fetched_at: string | null;
  } | null;

  return NextResponse.json({
    google_place_id: r2?.google_place_id ?? null,
    google_reviews_fetched_at: r2?.google_reviews_fetched_at ?? null,
    cache: cache ?? parseGoogleReviewsCache(r2?.google_reviews_cache),
  });
}
