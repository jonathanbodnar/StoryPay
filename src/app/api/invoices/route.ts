import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCustomer } from '@/lib/lunarpay';
import { findOrCreateContact, sendSms, sendEmail } from '@/lib/ghl';
import { generateToken } from '@/lib/utils';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    customerName, customerEmail, customerPhone,
    price, description, paymentType, paymentConfig,
    asDraft,
  } = body;

  if (!asDraft) {
    if (!customerName || !customerEmail) {
      return NextResponse.json({ error: 'Customer name and email are required' }, { status: 400 });
    }
    if (!price || price <= 0) {
      return NextResponse.json({ error: 'A valid price is required' }, { status: 400 });
    }
  }

  const publicToken = generateToken();

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_location_id, name')
    .eq('id', venueId)
    .single();

  let customerLunarpayId = null;

  if (!asDraft && venue?.lunarpay_secret_key && customerEmail) {
    try {
      const nameParts = (customerName || '').split(' ');
      const lpResult = await createCustomer(venue.lunarpay_secret_key, {
        firstName: nameParts[0] || customerName,
        lastName: nameParts.slice(1).join(' ') || '',
        email: customerEmail,
        phone: customerPhone || undefined,
      });
      const lpCustomer = lpResult.data || lpResult;
      customerLunarpayId = lpCustomer.id;
    } catch (err) {
      console.error('LunarPay customer creation failed:', err);
    }
  }

  const invoiceContent = description
    ? `<div><h2>Invoice</h2><p>${description.replace(/\n/g, '<br/>')}</p></div>`
    : '<div><h2>Invoice</h2></div>';

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .insert({
      venue_id: venueId,
      customer_name: customerName || null,
      customer_email: customerEmail || null,
      customer_phone: customerPhone || null,
      customer_lunarpay_id: customerLunarpayId,
      price: price || 0,
      payment_type: paymentType || 'full',
      payment_config: paymentConfig || {},
      content: invoiceContent,
      status: asDraft ? 'draft' : 'sent',
      sent_at: asDraft ? null : new Date().toISOString(),
      public_token: publicToken,
    })
    .select()
    .single();

  if (error || !proposal) {
    console.error('Invoice creation failed:', error);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }

  if (!asDraft && venue?.ghl_connected && venue.ghl_access_token && venue.ghl_location_id && customerEmail) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const proposalUrl = `${appUrl}/proposal/${publicToken}`;

    try {
      const contactId = await findOrCreateContact(
        venue.ghl_access_token,
        venue.ghl_location_id,
        {
          email: customerEmail,
          phone: customerPhone || undefined,
          firstName: (customerName || '').split(' ')[0],
          lastName: (customerName || '').split(' ').slice(1).join(' ') || undefined,
        }
      );

      if (contactId) {
        if (customerPhone) {
          try {
            await sendSms(
              venue.ghl_access_token,
              venue.ghl_location_id,
              contactId,
              `Hi ${(customerName || '').split(' ')[0]}, ${venue.name} has sent you an invoice. View and pay here: ${proposalUrl}`
            );
          } catch (smsErr) {
            console.error('[invoice] SMS failed:', smsErr);
          }
        }

        try {
          await sendEmail(venue.ghl_access_token, venue.ghl_location_id, {
            contactId,
            subject: `Invoice from ${venue.name}`,
            html: `
              <div style="font-family: 'Open Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #293745; padding: 24px 32px; border-radius: 12px 12px 0 0;">
                  <h1 style="color: white; font-family: 'Playfair Display', Georgia, serif; font-size: 24px; margin: 0; font-weight: 300;">Invoice from ${venue.name}</h1>
                </div>
                <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                  <p style="color: #374151; font-size: 15px; line-height: 1.6;">
                    Hi ${(customerName || '').split(' ')[0]},<br><br>
                    You have a new invoice from ${venue.name}. Click below to review and complete payment.
                  </p>
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${proposalUrl}" style="display: inline-block; background-color: #293745; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">View & Pay Invoice</a>
                  </div>
                  <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 24px; margin-bottom: 0;">Powered by StoryPay & LunarPay</p>
                </div>
              </div>
            `,
          });
        } catch (emailErr) {
          console.error('[invoice] Email failed:', emailErr);
        }
      }
    } catch (err) {
      console.error('[invoice] GHL contact failed:', err);
    }
  }

  return NextResponse.json(proposal, { status: 201 });
}
