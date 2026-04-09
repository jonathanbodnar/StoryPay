import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const SUPPORT_EMAIL = 'clients@storyvenuemarketing.com';

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
    .select('name, ghl_access_token, ghl_location_id')
    .eq('id', venueId)
    .single();

  const { error } = await supabaseAdmin
    .from('support_tickets')
    .insert({
      venue_id: venueId,
      subject,
      category: category || 'general',
      message,
      email,
      status: 'open',
    });

  if (error) {
    console.error('Support ticket insert failed:', error);
    return NextResponse.json({ error: 'Failed to submit ticket' }, { status: 500 });
  }

  if (venue?.ghl_access_token && venue?.ghl_location_id) {
    try {
      const searchRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${venue.ghl_location_id}&email=${encodeURIComponent(SUPPORT_EMAIL)}`,
        {
          headers: {
            Authorization: `Bearer ${venue.ghl_access_token}`,
            Version: '2021-07-28',
          },
        }
      );
      const searchData = await searchRes.json();
      let contactId = searchData?.contact?.id;

      if (!contactId) {
        const createRes = await fetch('https://services.leadconnectorhq.com/contacts/', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${venue.ghl_access_token}`,
            'Content-Type': 'application/json',
            Version: '2021-07-28',
          },
          body: JSON.stringify({
            locationId: venue.ghl_location_id,
            email: SUPPORT_EMAIL,
            name: 'StoryPay Support',
          }),
        });
        const createData = await createRes.json();
        contactId = createData?.contact?.id;
      }

      if (contactId) {
        await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${venue.ghl_access_token}`,
            'Content-Type': 'application/json',
            Version: '2021-07-28',
          },
          body: JSON.stringify({
            type: 'Email',
            contactId,
            subject: `[StoryPay Support] ${subject}`,
            html: `
              <div style="font-family: 'Open Sans', Arial, sans-serif; max-width: 600px;">
                <h2 style="color: #1b1b1b; font-family: 'Playfair Display', Georgia, serif;">Support Ticket</h2>
                <p><strong>Venue:</strong> ${venue.name || 'Unknown'}</p>
                <p><strong>From:</strong> ${email}</p>
                <p><strong>Category:</strong> ${category || 'General'}</p>
                <p><strong>Subject:</strong> ${subject}</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
                <p>${message.replace(/\n/g, '<br/>')}</p>
              </div>
            `,
          }),
        });
        console.log('Support ticket email sent via GHL');
      }
    } catch (emailErr) {
      console.error('Failed to send support email via GHL:', emailErr);
    }
  }

  return NextResponse.json({ success: true });
}
