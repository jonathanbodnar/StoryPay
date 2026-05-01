export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function OPTIONS() { return corsPreflight(); }

const VALID_EVENTS = new Set([
  'lead.created',
  'lead.updated',
  'contact.created',
  'contact.updated',
  'tag.added',
  'proposal.sent',
  'proposal.signed',
  'payment.received',
  'appointment.booked',
  'appointment.cancelled',
  'form.submitted',
]);

/** GET — list this key's webhook subscriptions. */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin
    .from('venue_webhook_subscriptions')
    .select('id, event_type, target_url, source, active, last_fired_at, fail_count, created_at')
    .eq('venue_id', auth.venueId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  return NextResponse.json({ subscriptions: data || [] }, { headers: CORS_HEADERS });
}

/**
 * POST — create a subscription. Zapier calls this when a Zap is enabled.
 * Body: { event: "lead.created", target_url: "https://hooks.zapier.com/..." }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    event?: string;
    target_url?: string;
    source?: string;
  };

  const event = (body.event || '').trim();
  const target_url = (body.target_url || '').trim();
  if (!event || !VALID_EVENTS.has(event)) {
    return NextResponse.json(
      { error: 'invalid_event', valid_events: [...VALID_EVENTS] },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  if (!target_url || !/^https?:\/\//.test(target_url)) {
    return NextResponse.json({ error: 'invalid_target_url' }, { status: 400, headers: CORS_HEADERS });
  }

  const { data, error } = await supabaseAdmin
    .from('venue_webhook_subscriptions')
    .insert({
      venue_id: auth.venueId,
      api_key_id: auth.apiKey.id,
      event_type: event,
      target_url,
      source: body.source || 'zapier',
      active: true,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  return NextResponse.json({ subscription: data }, { status: 201, headers: CORS_HEADERS });
}
