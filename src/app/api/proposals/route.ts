import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCustomer } from '@/lib/lunarpay';
import { ghlRequest, sendSms, sendEmail, findOrCreateContact } from '@/lib/ghl';
import { generateToken } from '@/lib/utils';
import { sendEmail as directSendEmail, proposalEmailHtml } from '@/lib/email';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = request.nextUrl.searchParams.get('limit');
  const status = request.nextUrl.searchParams.get('status');

  let query = supabaseAdmin
    .from('proposals')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  if (limit) {
    query = query.limit(parseInt(limit, 10));
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    templateId, customerName, customerEmail, customerPhone,
    ghlContactId, customerId,
    price, paymentType, paymentConfig,
    asDraft,
  } = body;

  if (!templateId) {
    return NextResponse.json({ error: 'templateId is required' }, { status: 400 });
  }

  const isDraft = !!asDraft;

  if (!isDraft) {
    if (!customerName || !customerEmail) {
      return NextResponse.json(
        { error: 'customerName and customerEmail are required to send' },
        { status: 400 }
      );
    }
    if (!price || price <= 0) {
      return NextResponse.json({ error: 'A valid price is required' }, { status: 400 });
    }
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_location_id, name')
    .eq('id', venueId)
    .single();

  const { data: template, error: templateError } = await supabaseAdmin
    .from('proposal_templates')
    .select('content')
    .eq('id', templateId)
    .eq('venue_id', venueId)
    .single();

  if (templateError || !template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const { data: sigFields } = await supabaseAdmin
    .from('proposal_template_fields')
    .select('*')
    .eq('template_id', templateId)
    .order('sort_order', { ascending: true });

  const publicToken = generateToken();

  if (isDraft) {
    const { data: proposal, error: insertError } = await supabaseAdmin
      .from('proposals')
      .insert({
        venue_id: venueId,
        template_id: templateId,
        customer_name: customerName || null,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        content: template.content,
        price: price || 0,
        payment_type: paymentType || 'full',
        payment_config: paymentConfig || {},
        signature_fields: sigFields ?? [],
        public_token: publicToken,
        status: 'draft',
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json(proposal, { status: 201 });
  }

  // --- Sending flow ---

  // 1. Create LunarPay customer for payment processing
  let customerLunarpayId = customerId || null;

  if (venue?.lunarpay_secret_key && !customerLunarpayId) {
    try {
      const nameParts = customerName.split(' ');
      const lpResult = await createCustomer(venue.lunarpay_secret_key, {
        firstName: nameParts[0] || customerName,
        lastName: nameParts.slice(1).join(' ') || '',
        email: customerEmail,
        phone: customerPhone || undefined,
      });
      const lpCustomer = lpResult.data || lpResult;
      customerLunarpayId = lpCustomer.id;
    } catch (err) {
      console.error('[proposal-send] LunarPay customer creation failed:', err);
    }
  }

  // 2. Insert proposal
  const { data: proposal, error: insertError } = await supabaseAdmin
    .from('proposals')
    .insert({
      venue_id: venueId,
      template_id: templateId,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone || null,
      customer_lunarpay_id: customerLunarpayId,
      content: template.content,
      price,
      payment_type: paymentType || 'full',
      payment_config: paymentConfig || {},
      signature_fields: sigFields ?? [],
      public_token: publicToken,
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const proposalUrl = `${appUrl}/proposal/${publicToken}`;

  // 3. Send via GHL (SMS + Email)
  if (venue?.ghl_connected && venue.ghl_access_token && venue.ghl_location_id) {
    try {
      // Find or use existing GHL contact
      let contactId = ghlContactId || null;

      if (!contactId) {
        contactId = await findOrCreateContact(
          venue.ghl_access_token,
          venue.ghl_location_id,
          {
            email: customerEmail,
            phone: customerPhone || undefined,
            firstName: customerName.split(' ')[0],
            lastName: customerName.split(' ').slice(1).join(' ') || undefined,
          }
        );
      }

      if (contactId) {
        // Send SMS if customer has a phone number
        if (customerPhone) {
          try {
            await sendSms(
              venue.ghl_access_token,
              venue.ghl_location_id,
              contactId,
              `Hi ${customerName.split(' ')[0]}, ${venue.name} has sent you a proposal. View and sign here: ${proposalUrl}`
            );
            console.log(`[proposal-send] SMS sent to contact ${contactId}`);
          } catch (smsErr) {
            console.error('[proposal-send] SMS failed:', smsErr);
          }
        }

        // Send email
        try {
          await sendEmail(
            venue.ghl_access_token,
            venue.ghl_location_id,
            {
              contactId,
              subject: `Proposal from ${venue.name}`,
              html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #1a1a2e;">You have a new proposal from ${venue.name}</h2>
                  <p style="color: #555; font-size: 16px; line-height: 1.6;">
                    Hi ${customerName.split(' ')[0]},<br><br>
                    ${venue.name} has prepared a proposal for you. Click the button below to review, sign, and complete your payment.
                  </p>
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${proposalUrl}" style="display: inline-block; background-color: #293745; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                      View Proposal
                    </a>
                  </div>
                  <p style="color: #999; font-size: 13px;">
                    If the button doesn't work, copy and paste this link: ${proposalUrl}
                  </p>
                  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
                  <p style="color: #bbb; font-size: 12px; text-align: center;">
                    Sent via StoryPay on behalf of ${venue.name}
                  </p>
                </div>
              `,
            }
          );
          console.log(`[proposal-send] Email sent to contact ${contactId}`);
        } catch (emailErr) {
          console.error('[proposal-send] Email failed:', emailErr);
        }
      } else {
        console.error('[proposal-send] Could not find or create GHL contact for', customerEmail);
      }
    } catch (err) {
      console.error('[proposal-send] GHL contact lookup failed:', err);
    }
  } else {
    console.log('[proposal-send] GHL not connected — sending direct email');
  }

  // Always send direct email — ensures delivery regardless of GHL status
  if (customerEmail) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const proposalUrl = `${appUrl}/proposal/${publicToken}`;
    const clientFirst = customerName.split(' ')[0];

    // Fetch brand color
    const { data: venueData } = await supabaseAdmin
      .from('venues')
      .select('brand_color')
      .eq('id', venueId)
      .single();

    await directSendEmail({
      to: customerEmail,
      subject: `Proposal from ${venue?.name || 'Your Venue'}`,
      html: proposalEmailHtml({
        venueName: venue?.name || 'Your Venue',
        clientFirstName: clientFirst,
        proposalUrl,
        brandColor: venueData?.brand_color || '#293745',
      }),
    });
  }

  return NextResponse.json(proposal, { status: 201 });
}
