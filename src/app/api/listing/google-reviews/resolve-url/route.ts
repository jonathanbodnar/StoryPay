/**
 * POST /api/listing/google-reviews/resolve-url
 *
 * Accepts a Google Maps URL (full or short link like maps.app.goo.gl/...)
 * and returns the Place ID + business info so the owner never has to
 * copy a cryptic ID string.
 *
 * Supported URL formats:
 *   https://maps.app.goo.gl/XXXXXX            (share short link)
 *   https://www.google.com/maps/place/Name/@lat,lng,z/data=!...!1sChIJ...
 *   https://maps.google.com/?cid=1234567890    (CID link)
 *   https://www.google.com/maps?q=place_id:ChIJ...
 *
 * Body: { url: string }
 * Response: { place_id, name, formatted_address, rating, user_ratings_total }
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

/** Try to extract a Place ID directly from a Google Maps URL string. */
function extractPlaceIdFromUrl(url: string): string | null {
  // Format: /maps/place/Name/...!1sChIJ...  (Place ID in data segment)
  const placeIdMatch = url.match(/[!?&]1s(ChIJ[A-Za-z0-9_-]{10,50})/);
  if (placeIdMatch) return placeIdMatch[1];

  // Format: place_id:ChIJ... in query
  const queryMatch = url.match(/place_id[:=](ChIJ[A-Za-z0-9_-]{10,50})/i);
  if (queryMatch) return queryMatch[1];

  // Format: /place/ in path followed by encoded name — no Place ID, need CID or search
  return null;
}

/** Extract a CID (numeric business ID) from a Google Maps URL. */
function extractCidFromUrl(url: string): string | null {
  const cidMatch = url.match(/[?&]cid=(\d+)/);
  if (cidMatch) return cidMatch[1];
  // Also in data blob: !4m..!...!8m..!...
  const cidData = url.match(/[!&]2s(\d{15,20})/);
  if (cidData) return cidData[1];
  return null;
}

/** Follow a short URL redirect to get the final destination. */
async function resolveShortUrl(shortUrl: string): Promise<string | null> {
  try {
    const res = await fetch(shortUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    return res.url || null;
  } catch {
    return null;
  }
}

/** Look up a place by CID using Places API text search. */
async function lookupByCid(cid: string, key: string) {
  const url = `https://places.googleapis.com/v1/places:searchText`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount',
    },
    body: JSON.stringify({ textQuery: `cid:${cid}`, maxResultCount: 1 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = await res.json() as { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; rating?: number; userRatingCount?: number }> };
  const p = data.places?.[0];
  if (!p?.id) return null;
  return {
    place_id: p.id,
    name: p.displayName?.text ?? 'Unknown',
    formatted_address: p.formattedAddress ?? '',
    rating: typeof p.rating === 'number' ? Math.round(p.rating * 10) / 10 : null,
    user_ratings_total: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
  };
}

/** Look up a place by ID using Places API detail endpoint. */
async function lookupByPlaceId(placeId: string, key: string) {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=id,displayName,formattedAddress,rating,userRatingCount`,
    {
      headers: { 'X-Goog-Api-Key': key },
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!res.ok) return null;
  const p = await res.json() as { id?: string; displayName?: { text?: string }; formattedAddress?: string; rating?: number; userRatingCount?: number };
  if (!p?.id) return null;
  return {
    place_id: p.id,
    name: p.displayName?.text ?? 'Unknown',
    formatted_address: p.formattedAddress ?? '',
    rating: typeof p.rating === 'number' ? Math.round(p.rating * 10) / 10 : null,
    user_ratings_total: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = placesApiKey();
  if (!key) return NextResponse.json({ error: 'Google API key not configured on server' }, { status: 503 });

  let rawUrl: string;
  try {
    const body = await req.json();
    rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!rawUrl) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

  // Normalise — add https:// if missing
  const urlStr = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;

  // Step 1: resolve short URLs (maps.app.goo.gl, goo.gl)
  let resolvedUrl = urlStr;
  if (/goo\.gl|maps\.app\.goo\.gl/.test(urlStr)) {
    const followed = await resolveShortUrl(urlStr);
    if (followed) resolvedUrl = followed;
  }

  // Step 2: try to extract Place ID directly from the URL
  const directPlaceId = extractPlaceIdFromUrl(resolvedUrl);
  if (directPlaceId) {
    const result = await lookupByPlaceId(directPlaceId, key);
    if (result) return NextResponse.json(result);
  }

  // Step 3: try CID lookup
  const cid = extractCidFromUrl(resolvedUrl);
  if (cid) {
    const result = await lookupByCid(cid, key);
    if (result) return NextResponse.json(result);
  }

  // Step 4: try to extract business name from URL path and do a text search
  const pathMatch = resolvedUrl.match(/\/maps\/place\/([^/@?]+)/);
  if (pathMatch) {
    const name = decodeURIComponent(pathMatch[1].replace(/\+/g, ' '));
    const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount',
      },
      body: JSON.stringify({ textQuery: name, maxResultCount: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    if (searchRes.ok) {
      const data = await searchRes.json() as { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; rating?: number; userRatingCount?: number }> };
      const p = data.places?.[0];
      if (p?.id) {
        return NextResponse.json({
          place_id: p.id,
          name: p.displayName?.text ?? 'Unknown',
          formatted_address: p.formattedAddress ?? '',
          rating: typeof p.rating === 'number' ? Math.round(p.rating * 10) / 10 : null,
          user_ratings_total: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
        });
      }
    }
  }

  return NextResponse.json(
    { error: "Couldn't find a business from that link. Try opening your Google Business Profile in Maps, then copy the URL from your browser's address bar." },
    { status: 404 }
  );
}
