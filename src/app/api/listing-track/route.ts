import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Allow the listing page (served from a different domain, e.g. storyvenue.com)
// to POST events to this API cross-origin.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

  // Geo from Cloudflare or Vercel edge headers (zero cost, works on Railway behind CF)
  const country =
    getHeader(req, 'cf-ipcountry', 'x-vercel-ip-country') ?? null;
  const region =
    getHeader(req, 'x-vercel-ip-country-region', 'cf-region-code') ?? null;
  const city =
    getHeader(req, 'x-vercel-ip-city', 'cf-ipcity') ?? null;

  const { error } = await supabaseAdmin.from('listing_events').insert({
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
  });

  if (error) {
    if (/listing_events/i.test(error.message)) {
      return NextResponse.json({ ok: true, warning: 'migration_pending' }, { headers: CORS_HEADERS });
    }
    return NextResponse.json({ ok: false }, { status: 500, headers: CORS_HEADERS });
  }

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
