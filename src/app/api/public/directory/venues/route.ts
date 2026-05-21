import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isPublicSponsoredStatus, isPublicVerifiedStatus } from '@/lib/directory-badges';

// Dynamic so revalidatePath() from the listing PATCH can bust this immediately.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Short CDN TTL with no stale-while-revalidate — publish/unpublish changes
// appear within seconds instead of lingering for up to 5 minutes.
const CACHE_TTL = 'public, s-maxage=10, stale-while-revalidate=0';

function corsHeaders() {
  const origin = process.env.PUBLIC_DIRECTORY_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': CACHE_TTL,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// US state abbreviation → full name
const STATE_ABBR: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',
  KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',
  MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',
  NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',
  NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
  OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
  DC:'District of Columbia',
};

function resolveState(raw: string): string {
  const up = raw.trim().toUpperCase();
  if (STATE_ABBR[up]) return STATE_ABBR[up]; // "IN" → "Indiana"
  return raw.trim();
}

/**
 * Parse a free-text "City, State" or "City ST" string.
 * Examples: "Fremont, Indiana", "Fremont, IN", "Columbus OH"
 */
function parseCityState(location: string): { city: string; state: string } {
  const trimmed = location.trim();
  const commaIdx = trimmed.lastIndexOf(',');
  if (commaIdx > 0) {
    return {
      city: trimmed.slice(0, commaIdx).trim(),
      state: resolveState(trimmed.slice(commaIdx + 1).trim()),
    };
  }
  // Trailing 2-letter abbreviation: "Fremont IN"
  const abbrMatch = trimmed.match(/^(.+)\s+([A-Za-z]{2})$/);
  if (abbrMatch && STATE_ABBR[abbrMatch[2].toUpperCase()]) {
    return { city: abbrMatch[1].trim(), state: STATE_ABBR[abbrMatch[2].toUpperCase()] };
  }
  return { city: trimmed, state: '' };
}

/**
 * Published venues for directory browse/search (storyvenue.com city/state/search pages).
 * Query params (all optional):
 *   state    — full state name or 2-letter abbreviation, e.g. "Indiana" or "IN"
 *   city     — partial city name
 *   q        — venue name search; if it looks like "City, State" it is parsed as location
 *   location — free-text "City, State" / "City, ST" — split into city + state automatically
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  let state    = (searchParams.get('state')    || '').trim();
  let city     = (searchParams.get('city')     || '').trim();
  const q      = (searchParams.get('q')        || '').trim();
  const location = (searchParams.get('location') || '').trim();

  // "location" param splits "City, State" into separate city/state filters
  if (location) {
    const parsed = parseCityState(location);
    if (!city  && parsed.city)  city  = parsed.city;
    if (!state && parsed.state) state = parsed.state;
  }

  // If q contains a comma and looks like "City, State", parse it instead of
  // doing a name search — this handles the common case of typing "Fremont, Indiana"
  if (q && !city && !state && /,/.test(q)) {
    const parsed = parseCityState(q);
    if (parsed.state) {
      city  = parsed.city;
      state = parsed.state;
    }
  }

  if (state) state = resolveState(state);

  let query = supabaseAdmin
    .from('venues')
    .select(
      'id, slug, name, location_city, location_state, directory_verified_status, directory_sponsored_status',
    )
    .eq('is_published', true)
    .neq('is_demo', true)   // demo venues never appear in public search
    .not('slug', 'is', null)
    .neq('slug', '');

  if (state) {
    query = query.ilike('location_state', state);
  }
  if (city) {
    query = query.ilike('location_city', `%${city}%`);
  }
  // Only use q for name search when it wasn't consumed as a location
  if (q && !city && !state) {
    query = query.ilike('name', `%${q}%`);
  }

  const { data: rows, error } = await query.order('name', { ascending: true }).limit(500);

  if (error) {
    console.error('[public/directory/venues]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders() });
  }

  const venues = (rows ?? []).map((r: Record<string, unknown>) => {
    const vs = r.directory_verified_status != null ? String(r.directory_verified_status) : 'none';
    const ss = r.directory_sponsored_status != null ? String(r.directory_sponsored_status) : 'none';
    return {
      slug: String(r.slug ?? ''),
      name: String(r.name ?? ''),
      location_city: r.location_city != null ? String(r.location_city) : null,
      location_state: r.location_state != null ? String(r.location_state) : null,
      listing_verified: isPublicVerifiedStatus(vs),
      listing_sponsored: isPublicSponsoredStatus(ss),
    };
  });

  venues.sort((a, b) => {
    const sp = (Number(b.listing_sponsored) - Number(a.listing_sponsored)) as number;
    if (sp !== 0) return sp;
    const vp = (Number(b.listing_verified) - Number(a.listing_verified)) as number;
    if (vp !== 0) return vp;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ venues }, { headers: corsHeaders() });
}
