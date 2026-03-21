import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ghlRequest } from '@/lib/ghl';

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
    .select('name, ghl_connected, ghl_access_token, ghl_location_id')
    .eq('id', venueId)
    .single();

  if (venue?.ghl_connected && venue.ghl_access_token && venue.ghl_location_id) {
    try {
      const searchRes = await ghlRequest(
        `/contacts/search/duplicate?locationId=${venue.ghl_location_id}&email=${encodeURIComponent(email)}`,
        venue.ghl_access_token,
        { locationId: venue.ghl_location_id }
      );

      let contactId = searchRes.contact?.id;

      if (!contactId) {
        const createRes = await ghlRequest('/contacts/', venue.ghl_access_token, {
          method: 'POST',
          body: {
            locationId: venue.ghl_location_id,
            email,
            tags: ['storypay-support'],
          },
          locationId: venue.ghl_location_id,
        });
        contactId = createRes.contact?.id;
      }

      if (contactId) {
        await ghlRequest('/conversations/messages', venue.ghl_access_token, {
          method: 'POST',
          body: {
            type: 'Email',
            contactId,
            subject: `[Support] ${subject}`,
            message: `Category: ${category || 'General'}\nVenue: ${venue.name}\n\n${message}`,
          },
          locationId: venue.ghl_location_id,
        });
      }

      return NextResponse.json({ success: true, method: 'ghl' });
    } catch (err) {
      console.error('GHL support ticket failed:', err);
    }
  }

  const { error: dbError } = await supabaseAdmin
    .from('support_tickets')
    .insert({
      venue_id: venueId,
      subject,
      category: category || 'general',
      message,
      email,
      status: 'open',
    });

  if (dbError) {
    console.error('Support ticket DB insert failed:', dbError);
    return NextResponse.json({ success: true, method: 'queued' });
  }

  return NextResponse.json({ success: true, method: 'database' });
}
