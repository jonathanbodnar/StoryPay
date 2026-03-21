import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ghlRequest, sendSms } from '@/lib/ghl';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { phone, message, contactId } = await request.json();

  if (!phone || !message) {
    return NextResponse.json(
      { error: 'phone and message are required' },
      { status: 400 }
    );
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('ghl_access_token, ghl_location_id, ghl_connected')
    .eq('id', venueId)
    .single();

  if (!venue?.ghl_connected || !venue.ghl_access_token || !venue.ghl_location_id) {
    return NextResponse.json(
      { error: 'GHL is not connected for this venue' },
      { status: 400 }
    );
  }

  try {
    let resolvedContactId = contactId;

    if (!resolvedContactId) {
      const searchRes = await ghlRequest(
        `/contacts/search/duplicate?locationId=${venue.ghl_location_id}&phone=${encodeURIComponent(phone)}`,
        venue.ghl_access_token,
        { locationId: venue.ghl_location_id }
      );

      if (searchRes.contact?.id) {
        resolvedContactId = searchRes.contact.id;
      } else {
        const createRes = await ghlRequest('/contacts/', venue.ghl_access_token, {
          method: 'POST',
          body: {
            locationId: venue.ghl_location_id,
            phone,
          },
          locationId: venue.ghl_location_id,
        });
        resolvedContactId = createRes.contact?.id;
      }
    }

    if (!resolvedContactId) {
      return NextResponse.json(
        { error: 'Could not resolve or create GHL contact' },
        { status: 500 }
      );
    }

    const result = await sendSms(
      venue.ghl_access_token,
      venue.ghl_location_id,
      resolvedContactId,
      message
    );

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('GHL SMS send failed:', err);
    return NextResponse.json(
      { error: 'Failed to send SMS' },
      { status: 500 }
    );
  }
}
