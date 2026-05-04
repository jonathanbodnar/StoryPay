/**
 * Venue-facing AI Concierge "send a test SMS" endpoint.
 *
 *   POST { phone: string }
 *     → generates a single AI message using the venue's active prompt config
 *       against a synthetic test lead, then sends it via the venue's GHL
 *       integration to the supplied phone number.
 *
 * Eligibility:
 *   - Venue must be on the Venue Concierge add-on (directory_addon_concierge=true)
 *   - GHL must be connected (we need an SMS pipe)
 *   - A2P verification is RECOMMENDED but not required — carriers may filter
 *     unverified test sends, but we still attempt and surface the error.
 *
 * Side effects:
 *   - Creates / re-uses a GHL contact for the supplied phone number (so the
 *     venue can see it in their GHL inbox alongside the test message).
 *   - Does NOT log to ai_runs (lead_id is NOT NULL there) so test sends never
 *     count toward metrics or spend caps.
 *   - Does NOT create a row in `leads` — the synthetic context lives in
 *     memory only.
 *
 * The reply body always includes the AI-generated message text so the UI
 * can show the venue exactly what was sent, even if delivery later fails.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';
import {
  sendSms as ghlSendSms,
  findOrCreateContact,
  getGhlToken,
  normalizePhone,
} from '@/lib/ghl';
import { buildAiConciergeTestSystemPrompt } from '@/lib/ai-concierge/prompt-builder';
import { generateSmsWithDeepSeek } from '@/lib/ai-concierge/llm';

export const dynamic = 'force-dynamic';

interface PostBody {
  phone?: string;
  /** Optional first-name override for the synthetic bride (defaults to "Sarah"). */
  brideFirstName?: string;
}

interface VenueAuthRow {
  id:                          string;
  ghl_access_token:            string | null;
  ghl_refresh_token:           string | null;
  ghl_location_id:             string | null;
  ghl_connected:               boolean | null;
  directory_addon_concierge:   boolean | null;
  a2p_verified:                boolean | null;
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: PostBody;
  try { body = await request.json() as PostBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const phoneRaw = (body.phone || '').trim();
  if (!phoneRaw) return NextResponse.json({ error: 'phone is required' }, { status: 400 });

  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    return NextResponse.json(
      { error: 'Could not parse that phone number. Use US format like +15551234567 or (555) 123-4567.' },
      { status: 400 },
    );
  }

  // Load venue + auth
  const { data: venueRow, error: vErr } = await supabaseAdmin
    .from('venues')
    .select('id, ghl_access_token, ghl_refresh_token, ghl_location_id, ghl_connected, directory_addon_concierge, a2p_verified')
    .eq('id', user.venueId)
    .maybeSingle();
  if (vErr) return NextResponse.json({ error: 'Venue lookup failed' }, { status: 500 });
  const venue = venueRow as VenueAuthRow | null;
  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  if (!venue.directory_addon_concierge) {
    return NextResponse.json({
      error: 'Venue Concierge add-on is required to test the AI. Upgrade on the billing page first.',
    }, { status: 422 });
  }
  if (!venue.ghl_location_id) {
    return NextResponse.json({
      error: 'GHL is not connected. Connect on the General settings page before sending a test.',
    }, { status: 422 });
  }
  const accessToken = getGhlToken({ ghl_access_token: venue.ghl_access_token });
  if (!accessToken) {
    return NextResponse.json({
      error: 'No GHL access token. Reconnect GHL on the General settings page.',
    }, { status: 422 });
  }

  // 1. Build prompt against the synthetic test lead
  const promptResult = await buildAiConciergeTestSystemPrompt({
    venueId:        venue.id,
    brideFirstName: body.brideFirstName,
  });
  if (!promptResult.ok) {
    return NextResponse.json({ error: promptResult.error }, { status: 422 });
  }

  // 2. Generate SMS via DeepSeek
  const gen = await generateSmsWithDeepSeek({ systemPrompt: promptResult.systemPrompt });
  if (!gen.ok) {
    return NextResponse.json({
      error:    `AI generator failed: ${gen.error}`,
      detail:   gen.detail,
      preview:  gen.rawModelOutput ?? null,
    }, { status: 502 });
  }

  // Add a [TEST] prefix so the recipient (the venue owner) sees this is a test
  // and so any compliance reviewer pulling samples can tell production from test.
  const smsToSend = `[TEST] ${gen.smsText}`;

  // 3. Find / create a GHL contact for this phone
  let ghlContactId: string;
  try {
    const created = await findOrCreateContact(accessToken, venue.ghl_location_id, {
      phone,
      firstName: body.brideFirstName?.trim() || 'AI',
      lastName:  'Test',
    });
    if (!created) {
      return NextResponse.json({
        ok:               false,
        error:            'GHL findOrCreateContact returned null',
        generatedMessage: gen.smsText,
        angle:            gen.angle,
      }, { status: 502 });
    }
    ghlContactId = created;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown GHL error';
    return NextResponse.json({
      ok:               false,
      error:            `GHL contact lookup failed: ${msg}`,
      generatedMessage: gen.smsText,
      angle:            gen.angle,
    }, { status: 502 });
  }

  // 4. Send via GHL
  try {
    const res = await ghlSendSms(accessToken, venue.ghl_location_id, ghlContactId, smsToSend);
    return NextResponse.json({
      ok:                true,
      generatedMessage:  gen.smsText,
      sentMessage:       smsToSend,
      angle:             gen.angle,
      providerMessageId: extractMessageId(res),
      a2pVerified:       venue.a2p_verified === true,
      a2pWarning: venue.a2p_verified !== true
        ? 'Sent without A2P verification — carriers may filter the message. Verify A2P in your GHL account before going live.'
        : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown GHL error';
    return NextResponse.json({
      ok:               false,
      error:            `GHL send failed: ${msg}`,
      generatedMessage: gen.smsText,
      angle:            gen.angle,
    }, { status: 502 });
  }
}

function extractMessageId(res: unknown): string | undefined {
  if (!res || typeof res !== 'object') return undefined;
  const r = res as Record<string, unknown>;
  if (typeof r.messageId === 'string' && r.messageId) return r.messageId;
  if (typeof r.id === 'string' && r.id) return r.id;
  const data = r.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.messageId === 'string' && d.messageId) return d.messageId;
    if (typeof d.id        === 'string' && d.id)        return d.id;
  }
  return undefined;
}
