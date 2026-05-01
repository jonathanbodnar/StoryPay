export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { findOrCreateContact, getGhlToken, sendSms } from '@/lib/ghl';

export async function OPTIONS() { return corsPreflight(); }

interface VenueRow {
  id: string;
  ghl_access_token: string | null;
  ghl_location_id: string | null;
}

/**
 * Action: Send SMS to a phone number.
 * Body: { to: "+15551234567", message: "Hi", first_name?, last_name?, email? }
 *
 * Uses the same GHL/legacy SMS plumbing as the rest of the app, so DND
 * checks and conversation logging happen automatically.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    to?: string;
    message?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  const to = (body.to || '').trim();
  const message = (body.message || '').trim();
  if (!to || !message) {
    return NextResponse.json({ error: 'to_and_message_required' }, { status: 400, headers: CORS_HEADERS });
  }

  const { data: venueData } = await supabaseAdmin
    .from('venues')
    .select('id, ghl_access_token, ghl_location_id')
    .eq('id', auth.venueId)
    .maybeSingle();
  const venue = venueData as VenueRow | null;
  if (!venue) return NextResponse.json({ error: 'venue_not_found' }, { status: 404, headers: CORS_HEADERS });

  const accessToken = getGhlToken(venue);
  const locationId = venue.ghl_location_id;
  if (!accessToken || !locationId) {
    return NextResponse.json(
      { error: 'sms_not_configured', message: 'Connect a messaging integration in Settings → Integrations to send SMS.' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const contactId = await findOrCreateContact(accessToken, locationId, {
      phone: to,
      email: body.email || undefined,
      firstName: body.first_name || undefined,
      lastName: body.last_name || undefined,
    });
    if (!contactId) {
      return NextResponse.json({ error: 'contact_create_failed' }, { status: 502, headers: CORS_HEADERS });
    }
    await sendSms(accessToken, locationId, contactId, message);
    return NextResponse.json({ success: true, contact_id: contactId }, { headers: CORS_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sms_send_failed';
    return NextResponse.json({ error: msg }, { status: 502, headers: CORS_HEADERS });
  }
}
