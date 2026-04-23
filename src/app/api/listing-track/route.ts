import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const VALID_EVENTS = new Set([
  'page_view',
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
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
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
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!VALID_EVENTS.has(event_type)) {
    return NextResponse.json({ ok: false }, { status: 400 });
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
    // Silently swallow schema-not-ready errors so missing migration doesn't break the listing page
    if (/listing_events/i.test(error.message)) {
      return NextResponse.json({ ok: true, warning: 'migration_pending' });
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
