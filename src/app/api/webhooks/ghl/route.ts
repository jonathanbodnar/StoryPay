import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const eventType = payload.type || payload.event;

    console.log('GHL webhook received:', eventType, JSON.stringify(payload).slice(0, 500));

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
