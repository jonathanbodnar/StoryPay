import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { insertInboundGhlSms, parseGhlInboundSmsPayload } from '@/lib/ghl-sms-conversations';

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const eventType = payload.type || payload.event;

    console.log('GHL webhook received:', eventType, JSON.stringify(payload).slice(0, 500));

    const inboundSms = parseGhlInboundSmsPayload(payload);
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
      case 'ContactUpdate':
        break;

      case 'AppInstall': {
        const { locationId, access_token, refresh_token } = payload;
        if (locationId && access_token) {
          await supabaseAdmin
            .from('venues')
            .update({
              ghl_access_token: access_token,
              ghl_refresh_token: refresh_token,
              ghl_location_id: locationId,
              ghl_location_token: access_token,
              ghl_connected: true,
            })
            .eq('ghl_location_id', locationId);
        }
        break;
      }

      case 'AppUninstall': {
        const { locationId: uninstallLocId } = payload;
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
