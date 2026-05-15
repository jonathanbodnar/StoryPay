import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function corsHeaders() {
  const origin = process.env.PUBLIC_DIRECTORY_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Short cache — suggestions are near-real-time but stable enough for 30s
    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country_code?: string;
  };
  type: string;
  class: string;
  lat: string;
  lon: string;
}

export interface LocationSuggestion {
  label: string;    // Human-readable: "Fremont, Indiana"
  city: string;
  state: string;
  zip?: string;
  lat: number;
  lng: number;
}

/**
 * Public location autocomplete — powered by Nominatim (OpenStreetMap).
 * Returns US city/town/zip suggestions for a partial query.
 *
 * GET /api/public/location-suggestions?q=Fremont%2C+Indiana
 *
 * Returns: { suggestions: LocationSuggestion[] }
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') || '').trim();

  if (q.length < 2) {
    return NextResponse.json({ suggestions: [] }, { headers: corsHeaders() });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';

  try {
    const nominatimUrl =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(q)}` +
      `&format=json&addressdetails=1&limit=8&countrycodes=us` +
      `&featureType=city,town,village,hamlet,county,postcode`;

    const res = await fetch(nominatimUrl, {
      headers: {
        'Accept': 'application/json',
        // Nominatim requires a valid User-Agent identifying the application
        'User-Agent': `StoryVenueDirectory/1.0 (${appUrl})`,
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      return NextResponse.json({ suggestions: [] }, { headers: corsHeaders() });
    }

    const results: NominatimResult[] = await res.json();

    const seen = new Set<string>();
    const suggestions: LocationSuggestion[] = [];

    for (const r of results) {
      const addr = r.address;
      if (addr.country_code && addr.country_code !== 'us') continue;

      const city  = addr.city || addr.town || addr.village || addr.county || '';
      const state = addr.state || '';
      const zip   = addr.postcode || '';

      if (!city && !zip) continue;

      let label: string;
      if (zip && !city) {
        label = state ? `${zip}, ${state}` : zip;
      } else if (zip && city) {
        label = state ? `${city}, ${state} ${zip}` : `${city} ${zip}`;
      } else {
        label = state ? `${city}, ${state}` : city;
      }

      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      suggestions.push({
        label,
        city,
        state,
        zip: zip || undefined,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
      });
    }

    return NextResponse.json({ suggestions }, { headers: corsHeaders() });
  } catch (err) {
    console.error('[location-suggestions]', err);
    return NextResponse.json({ suggestions: [] }, { headers: corsHeaders() });
  }
}
