import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCustomer } from '@/lib/lunarpay';
import { findOrCreateContact, sendSms, sendEmail as ghlSendEmail } from '@/lib/ghl';
import { generateToken } from '@/lib/utils';
import { sendEmail as directSendEmail, invoiceEmailHtml } from '@/lib/email';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    customerName, customerEmail, customerPhone,
    price, lineItems, paymentType, paymentConfig,
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
    .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_location_id, name, brand_color, brand_logo_url')
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

  const items: { name: string; description: string; amount: number }[] =
    Array.isArray(lineItems) && lineItems.length > 0 ? lineItems : [];

  const formatAmount = (cents: number) =>
    (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const itemRows = items
    .map(
      (item) => `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; vertical-align: top;">
          <div style="font-weight: 600; color: #111827; font-size: 14px;">${item.name || '—'}</div>
          ${item.description ? `<div style="color: #6b7280; font-size: 13px; margin-top: 2px;">${item.description}</div>` : ''}
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; text-align: right; font-size: 14px; color: #111827; white-space: nowrap; vertical-align: top;">
          ${formatAmount(item.amount || 0)}
        </td>
      </tr>`
    )
    .join('');

  const invoiceContent = `
    <div style="font-family: 'Open Sans', Arial, sans-serif;">
      <h2 style="font-family: 'Playfair Display', Georgia, serif; font-size: 22px; font-weight: 400; color: #111827; margin: 0 0 20px;">Invoice</h2>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background-color: #f9fafb;">
            <th style="padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; border-bottom: 1px solid #e5e7eb;">Item / Service</th>
            <th style="padding: 10px 16px; text-align: right; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; border-bottom: 1px solid #e5e7eb;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows || '<tr><td colspan="2" style="padding: 16px; text-align: center; color: #9ca3af;">No items</td></tr>'}
        </tbody>
        <tfoot>
          <tr style="background-color: #f9fafb;">
            <td style="padding: 12px 16px; font-weight: 700; font-size: 14px; color: #111827; border-top: 2px solid #e5e7eb;">Total</td>
            <td style="padding: 12px 16px; text-align: right; font-weight: 700; font-size: 15px; color: #111827; border-top: 2px solid #e5e7eb;">${formatAmount(price || 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;

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
          await ghlSendEmail(venue.ghl_access_token, venue.ghl_location_id, {
            contactId,
            subject: `Invoice from ${venue.name}`,
            html: `
              <div style="font-family: 'Open Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #1b1b1b; padding: 24px 32px; border-radius: 12px 12px 0 0;">
                  <h1 style="color: white; font-family: 'Playfair Display', Georgia, serif; font-size: 24px; margin: 0; font-weight: 300;">Invoice from ${venue.name}</h1>
                </div>
                <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                  <p style="color: #374151; font-size: 15px; line-height: 1.6;">
                    Hi ${(customerName || '').split(' ')[0]},<br><br>
                    You have a new invoice from ${venue.name}. Click below to review and complete payment.
                  </p>
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${proposalUrl}" style="display: inline-block; background-color: #1b1b1b; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">View & Pay Invoice</a>
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

  // Direct email fallback — always send if GHL not connected or as extra delivery
  if (!asDraft && customerEmail) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const invoiceUrl = `${appUrl}/invoice/${proposal.id}`;
    const clientFirst = (customerName || 'there').split(' ')[0];
    const brandColor = (venue as { brand_color?: string; brand_logo_url?: string })?.brand_color || '#1b1b1b';
    const logoUrl    = (venue as { brand_logo_url?: string })?.brand_logo_url || undefined;
    const amountStr = `$${((price || 0) / 100).toFixed(2)}`;

    // Always send direct email — ensures delivery regardless of GHL status
    console.log(`[invoice] Sending email to ${customerEmail} via Resend`);
    const emailResult = await directSendEmail({
      to: customerEmail,
      subject: `Invoice from ${venue?.name || 'Your Venue'}`,
      html: invoiceEmailHtml({
        venueName: venue?.name || 'Your Venue',
        clientFirstName: clientFirst,
        invoiceUrl,
        amount: amountStr,
        logoUrl,
        brandColor,
      }),
    });
    console.log('[invoice] Email result:', JSON.stringify(emailResult));
  }

  return NextResponse.json(proposal, { status: 201 });
}
