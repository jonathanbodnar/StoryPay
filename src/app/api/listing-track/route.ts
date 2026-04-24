import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Allow the listing page (served from a different domain, e.g. storyvenue.com)
// to POST events to this API cross-origin.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Per-instance in-memory cache for IP -> geo so we don't call the lookup
// service on every heartbeat. A visitor pings every 30s, so caching per IP
// for an hour reduces thousands of calls to one.
type GeoRecord = {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
};
const geoCache = new Map<string, { value: GeoRecord; expires: number }>();
const GEO_TTL_MS = 60 * 60 * 1000; // 1 hour

// Flips to false the first time an insert fails because lat/lng columns
// don't exist (migration 057 hasn't been run yet). Prevents retrying every
// insert when the server knows the columns are missing.
let hasGeoCoords = true;

function extractClientIp(req: NextRequest): string | null {
  // Railway / Fastly / Cloudflare / Vercel all forward the client IP in one
  // of these headers. x-forwarded-for may contain a comma-separated chain
  // (client, proxy, proxy, ...); the first entry is the real client.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get('fastly-client-ip') ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    null
  );
}

async function lookupGeoFromIp(ip: string): Promise<GeoRecord> {
  const cached = geoCache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.value;

  // ip-api.com is free, no API key, 45 req/min per origin IP. We query only
  // the fields we need to keep the payload tiny. Timeout after 800ms so a
  // slow lookup never blocks event ingestion for long.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  let result: GeoRecord = { country: null, region: null, city: null, latitude: null, longitude: null };
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,lat,lon`,
      { signal: controller.signal, cache: 'no-store' }
    );
    if (res.ok) {
      const j = (await res.json()) as {
        status?: string;
        country?: string;
        countryCode?: string;
        regionName?: string;
        city?: string;
        lat?: number;
        lon?: number;
      };
      if (j.status === 'success') {
        result = {
          country: j.countryCode || j.country || null,
          region: j.regionName || null,
          city: j.city || null,
          latitude: typeof j.lat === 'number' ? j.lat : null,
          longitude: typeof j.lon === 'number' ? j.lon : null,
        };
      }
    }
  } catch {
    // Network error or timeout — leave fields null.
  } finally {
    clearTimeout(timer);
  }

  geoCache.set(ip, { value: result, expires: Date.now() + GEO_TTL_MS });
  return result;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const VALID_EVENTS = new Set([
  'page_view',
  'listing_impression',
  'session_heartbeat',
  'scroll_25', 'scroll_50', 'scroll_75', 'scroll_100',
  'photo_view',
  'faq_open',
  'map_click',
  'social_click',
  'contact_form_open',
  'contact_form_submit',
]);

function detectDevice(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile|wpdesktop/i.test(ua)) return 'mobile';
  return 'desktop';
}

function getHeader(req: NextRequest, ...names: string[]): string | null {
  for (const name of names) {
    const v = req.headers.get(name);
    if (v) return v;
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    // sendBeacon may send text/plain; read raw text and parse manually to be safe
    const text = await req.text();
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: CORS_HEADERS });
  }

  const { venue_id, session_id, event_type, event_data, referrer, utm_source, utm_medium, utm_campaign } = body as {
    venue_id?: string;
    session_id?: string;
    event_type?: string;
    event_data?: Record<string, unknown>;
    referrer?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
  };

  if (!venue_id || !session_id || !event_type) {
    return NextResponse.json({ ok: false }, { status: 400, headers: CORS_HEADERS });
  }
  if (!VALID_EVENTS.has(event_type)) {
    return NextResponse.json({ ok: false }, { status: 400, headers: CORS_HEADERS });
  }

  const ua = req.headers.get('user-agent') || '';
  const device_type = detectDevice(ua);

  // Prefer geo headers set by the edge (Cloudflare, Vercel). When the API
  // runs on Railway behind Fastly those headers aren't present, so we fall
  // back to a cached IP -> geo lookup. Cache is per-instance so at most one
  // external call per visitor per hour per instance.
  let country = getHeader(req, 'cf-ipcountry', 'x-vercel-ip-country') ?? null;
  let region =
    getHeader(req, 'x-vercel-ip-country-region', 'cf-region-code') ?? null;
  let city = getHeader(req, 'x-vercel-ip-city', 'cf-ipcity') ?? null;
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (!country || !city || latitude === null) {
    const ip = extractClientIp(req);
    if (ip && !/^(127\.|10\.|192\.168\.|::1|fe80:)/i.test(ip)) {
      const geo = await lookupGeoFromIp(ip);
      country = country || geo.country;
      region = region || geo.region;
      city = city || geo.city;
      latitude = geo.latitude;
      longitude = geo.longitude;
    }
  }

  const baseRow: Record<string, unknown> = {
    venue_id,
    session_id,
    event_type,
    event_data: event_data ?? {},
    referrer: referrer || null,
    utm_source: utm_source || null,
    utm_medium: utm_medium || null,
    utm_campaign: utm_campaign || null,
    device_type,
    country,
    region,
    city,
  };
  if (hasGeoCoords) {
    baseRow.latitude = latitude;
    baseRow.longitude = longitude;
  }

  let { error } = await supabaseAdmin.from('listing_events').insert(baseRow);

  // If the lat/lng columns don't exist yet (migration 057 pending), retry
  // without them and remember so we don't keep re-trying on every event.
  if (error && /latitude|longitude/i.test(error.message)) {
    hasGeoCoords = false;
    delete baseRow.latitude;
    delete baseRow.longitude;
    ({ error } = await supabaseAdmin.from('listing_events').insert(baseRow));
  }

  if (error) {
    if (/listing_events/i.test(error.message)) {
      return NextResponse.json({ ok: true, warning: 'migration_pending' }, { headers: CORS_HEADERS });
    }
    return NextResponse.json({ ok: false }, { status: 500, headers: CORS_HEADERS });
  }

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
