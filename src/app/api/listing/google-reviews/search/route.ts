/**
 * POST /api/listing/google-reviews/search
 *
 * Uses Google Text Search (Places API New) to find candidates for a venue's
 * Google Business Profile so venue owners never have to look up a Place ID.
 *
 * Body (all optional – omit query to auto-build from the venue record):
 *   { query?: string }
 *
 * Response:
 *   { candidates: GoogleCandidate[] }
 *
 * A GoogleCandidate has enough info for a confirmation card:
 *   { place_id, name, formatted_address, rating, user_ratings_total }
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export type GoogleCandidate = {
  place_id: string;
  name: string;
  formatted_address: string;
  rating: number | null;
  user_ratings_total: number | null;
};

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

function placesApiKey(): string | null {
  return (
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    null
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = placesApiKey();
  if (!key) {
    return NextResponse.json(
      { error: 'Google API key not configured on server' },
      { status: 503 },
    );
  }

  // Parse optional custom query from body.
  let customQuery: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.query === 'string' && body.query.trim()) {
      customQuery = body.query.trim();
    }
  } catch {
    // body is optional — continue with auto-generated query
  }

  // Build the search query from the venue record when no custom query provided.
  let searchQuery = customQuery ?? '';
  if (!searchQuery) {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('name, location_city, location_state')
      .eq('id', venueId)
      .maybeSingle();

    const parts = [
      venue?.name,
      venue?.location_city,
      venue?.location_state,
    ].filter(Boolean);

    if (parts.length === 0) {
      return NextResponse.json(
        { error: 'No venue name or location saved — add those first or type a search below.' },
        { status: 422 },
      );
    }
    searchQuery = parts.join(', ');
  }

  // Call Google Places API (New) Text Search.
  // We only need place IDs + display info, so use a minimal field mask to
  // keep costs low (Basic tier: ~$0.017 per 1000 requests).
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const body = {
    textQuery: searchQuery,
    maxResultCount: 5,
    // Restrict to "establishment" types to avoid matching residential addresses.
  };

  const gRes = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount',
    },
    body: JSON.stringify(body),
    next: { revalidate: 0 },
  });

  if (!gRes.ok) {
    const errText = await gRes.text().catch(() => '');
    console.warn('[google-reviews/search]', gRes.status, errText.slice(0, 300));
    return NextResponse.json(
      { error: `Google returned ${gRes.status}. Check API key and billing.` },
      { status: 502 },
    );
  }

  const gData = (await gRes.json()) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      rating?: number;
      userRatingCount?: number;
    }>;
  };

  const candidates: GoogleCandidate[] = (gData.places ?? []).map((p) => ({
    place_id: p.id ?? '',
    name: p.displayName?.text ?? 'Unknown',
    formatted_address: p.formattedAddress ?? '',
    rating: typeof p.rating === 'number' ? Math.round(p.rating * 10) / 10 : null,
    user_ratings_total: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
  })).filter((c) => c.place_id);

  return NextResponse.json({ candidates, query_used: searchQuery });
}
