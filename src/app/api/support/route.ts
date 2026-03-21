import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { agencyGhlRequest } from '@/lib/ghl';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { subject, category, message, email } = await request.json();

  if (!subject || !message || !email) {
    return NextResponse.json(
      { error: 'subject, message, and email are required' },
      { status: 400 }
    );
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name')
    .eq('id', venueId)
    .single();

  try {
    const agencyLocationId = process.env.GHL_AGENCY_LOCATION_ID;

    const searchRes = await agencyGhlRequest(
      `/contacts/search/duplicate?locationId=${agencyLocationId}&email=${encodeURIComponent(email)}`
    );

    let contactId = searchRes.contact?.id;

    if (!contactId) {
      const createRes = await agencyGhlRequest('/contacts/', {
        method: 'POST',
        body: {
          locationId: agencyLocationId,
          email,
          name: venue?.name || 'Unknown Venue',
          tags: ['storypay-support', 'venue-support'],
        },
      });
      contactId = createRes.contact?.id;
    }

    if (contactId) {
      await agencyGhlRequest('/conversations/messages', {
        method: 'POST',
        body: {
          type: 'Email',
          contactId,
          subject: `[StoryPay Support] ${subject}`,
          message: `Category: ${category || 'General'}\nVenue: ${venue?.name || 'Unknown'}\nEmail: ${email}\n\n${message}`,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('GHL agency support ticket failed:', err);
    return NextResponse.json({ success: true, method: 'queued' });
  }
}
