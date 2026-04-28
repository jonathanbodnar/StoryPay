import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  describeGhlInboundWebhookShape,
  insertInboundGhlSms,
  isGhlInboundMessageWebhookPayload,
  parseGhlInboundSmsPayload,
} from '@/lib/ghl-sms-conversations';
import { applySmsDndForVenueCustomer, isSmsOptOutKeyword } from '@/lib/sms-compliance';
import { syncSingleGhlContact } from '@/lib/ghl-contacts-sync';

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.error('[ghl webhook] invalid JSON body, len=', raw.length);
      return NextResponse.json({ received: true });
    }

    const eventType = payload.type || payload.event;

    console.log('GHL webhook received:', eventType, JSON.stringify(payload).slice(0, 500));

    const inboundSms = parseGhlInboundSmsPayload(payload);
    if (isGhlInboundMessageWebhookPayload(payload) && !inboundSms) {
      console.warn(
        '[ghl webhook] InboundMessage received but SMS not ingested — shape:',
        describeGhlInboundWebhookShape(payload)
      );
    }
    if (inboundSms) {
      const { data: venue } = await supabaseAdmin
        .from('venues')
        .select('id')
        .eq('ghl_location_id', inboundSms.locationId)
        .maybeSingle();
      if (venue?.id) {
        const r = await insertInboundGhlSms({
          venueId: venue.id as string,
          locationId: inboundSms.locationId,
          contactId: inboundSms.contactId,
          messageBody: inboundSms.body,
          ghlMessageId: inboundSms.messageId,
          contactName: inboundSms.contactName,
        });
        if (!r.ok) {
          console.error('[ghl webhook] inbound SMS ingest failed:', r.error);
        } else if (r.venueCustomerId && isSmsOptOutKeyword(inboundSms.body)) {
          await applySmsDndForVenueCustomer({
            venueId: venue.id as string,
            venueCustomerId: r.venueCustomerId,
            source: 'inbound_stop_keyword',
          });
        }
      } else {
        console.warn('[ghl webhook] inbound SMS: no venue for locationId', inboundSms.locationId);
      }
    }

    switch (eventType) {
      case 'InboundMessage':
      case 'OutboundMessage':
        break;

      case 'ContactCreate':
      case 'ContactUpdate': {
        const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>)
          : null;
        const locationId = (payload.locationId ?? data?.locationId) as string | undefined;
        const contactId  = (payload.contactId  ?? data?.id ?? data?.contactId) as string | undefined;
        if (locationId && contactId) {
          // Fire-and-forget — webhook responses must be quick; sync runs async.
          void syncSingleGhlContact(locationId, contactId).catch((err) => {
            console.error('[ghl webhook] ContactCreate/Update sync failed:', err);
          });
        }
        break;
      }

      case 'AppInstall': {
        const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>)
          : null;
        const locationId = (payload.locationId ?? data?.locationId) as string | undefined;
        const access_token = (payload.access_token ?? data?.access_token) as string | undefined;
        const refresh_token = (payload.refresh_token ?? data?.refresh_token) as string | undefined;
        if (locationId && access_token) {
          await supabaseAdmin
            .from('venues')
            .update({
              ghl_access_token: access_token,
              ghl_refresh_token: refresh_token ?? null,
              ghl_location_id: locationId,
              ghl_location_token: access_token,
              ghl_connected: true,
            })
            .eq('ghl_location_id', locationId);
        }
        break;
      }

      case 'AppUninstall': {
        const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>)
          : null;
        const uninstallLocId = (payload.locationId ?? data?.locationId) as string | undefined;
        if (uninstallLocId) {
          await supabaseAdmin
            .from('venues')
            .update({
              ghl_connected: false,
              ghl_access_token: null,
              ghl_refresh_token: null,
              ghl_location_token: null,
            })
            .eq('ghl_location_id', uninstallLocId);
        }
        break;
      }

      default:
        console.log('Unhandled GHL webhook event:', eventType);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('GHL webhook error:', err);
    return NextResponse.json({ received: true });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
