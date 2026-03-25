import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCheckoutSession, createPaymentSchedule, createSubscription } from '@/lib/lunarpay';

interface Installment {
  amount: number;
  date: string;
}

interface InstallmentConfig {
  installments: Installment[];
}

interface SubscriptionConfig {
  amount: number;
  frequency: string;
  start_date: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { session_id } = await request.json();

  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, venue_id, status, payment_type, payment_config, customer_name, customer_lunarpay_id')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (proposal.status === 'paid') {
    return NextResponse.json({ success: true, already_paid: true });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  try {
    const result = await getCheckoutSession(venue.lunarpay_secret_key, session_id);
    const session = result.data || result;

    if (session.status !== 'completed') {
      return NextResponse.json(
        { error: 'Payment not completed', status: session.status },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {
      status: 'paid',
      paid_at: session.paid_at || new Date().toISOString(),
      checkout_session_id: session_id,
      transaction_id: session.transaction_id || null,
    };

    // For installment plans, schedule the remaining payments via LunarPay
    if (proposal.payment_type === 'installment' && proposal.payment_config) {
      const config = proposal.payment_config as InstallmentConfig;
      const remaining = (config.installments || []).slice(1);

      if (remaining.length > 0 && session.customer_id) {
        try {
          const scheduleResult = await createPaymentSchedule(venue.lunarpay_secret_key, {
            customerId: session.customer_id,
            paymentMethodId: session.payment_method_id,
            description: `${proposal.customer_name} - Installment plan`,
            payments: remaining.map((p) => ({
              amount: p.amount,
              date: p.date,
            })),
          });
          const schedule = scheduleResult.data || scheduleResult;
          updateData.payment_schedule_id = schedule.id;
          console.log('Payment schedule created:', schedule.id);
        } catch (scheduleErr) {
          console.error('Failed to create payment schedule (first payment still succeeded):', scheduleErr);
        }
      }
    }

    // For subscriptions, create the recurring subscription via LunarPay
    if (proposal.payment_type === 'subscription' && proposal.payment_config) {
      const config = proposal.payment_config as SubscriptionConfig;

      if (session.customer_id && session.payment_method_id) {
        try {
          const subResult = await createSubscription(venue.lunarpay_secret_key, {
            customerId: session.customer_id,
            paymentMethodId: session.payment_method_id,
            amount: config.amount,
            frequency: config.frequency,
            startOn: config.start_date,
            description: `${proposal.customer_name} - ${config.frequency} subscription`,
          });
          const sub = subResult.data || subResult;
          updateData.subscription_id = sub.id;
          console.log('Subscription created:', sub.id);
        } catch (subErr) {
          console.error('Failed to create subscription (first payment still succeeded):', subErr);
        }
      }
    }

    await supabaseAdmin
      .from('proposals')
      .update(updateData)
      .eq('id', proposal.id);

    // Send receipt email via GHL
    try {
      const { data: fullVenue } = await supabaseAdmin
        .from('venues')
        .select('name, ghl_access_token, ghl_location_id')
        .eq('id', proposal.venue_id)
        .single();

      const { data: fullProposal } = await supabaseAdmin
        .from('proposals')
        .select('customer_email, price')
        .eq('id', proposal.id)
        .single();

      if (fullVenue?.ghl_access_token && fullVenue?.ghl_location_id && fullProposal?.customer_email) {
        const searchRes = await fetch(
          `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${fullVenue.ghl_location_id}&email=${encodeURIComponent(fullProposal.customer_email)}`,
          {
            headers: {
              Authorization: `Bearer ${fullVenue.ghl_access_token}`,
              Version: '2021-07-28',
            },
          }
        );
        const searchData = await searchRes.json();
        const contactId = searchData?.contact?.id;

        if (contactId) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
          const amountFormatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((fullProposal.price || 0) / 100);

          await fetch('https://services.leadconnectorhq.com/conversations/messages', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${fullVenue.ghl_access_token}`,
              'Content-Type': 'application/json',
              Version: '2021-07-28',
            },
            body: JSON.stringify({
              type: 'Email',
              contactId,
              subject: `Payment Receipt - ${fullVenue.name}`,
              html: `
                <div style="font-family: 'Open Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background-color: #293745; padding: 24px 32px; border-radius: 12px 12px 0 0;">
                    <h1 style="color: white; font-family: 'Playfair Display', Georgia, serif; font-size: 24px; margin: 0; font-weight: 300;">Payment Receipt</h1>
                  </div>
                  <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                    <p style="color: #374151; font-size: 15px; line-height: 1.6; margin-top: 0;">
                      Hi ${proposal.customer_name},
                    </p>
                    <p style="color: #374151; font-size: 15px; line-height: 1.6;">
                      Thank you for your payment! Here is your receipt:
                    </p>
                    <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin: 24px 0;">
                      <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Venue</td>
                          <td style="padding: 8px 0; text-align: right; color: #111827; font-weight: 600; font-size: 14px;">${fullVenue.name}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Amount Paid</td>
                          <td style="padding: 8px 0; text-align: right; color: #059669; font-weight: 600; font-size: 14px;">${amountFormatted}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Date</td>
                          <td style="padding: 8px 0; text-align: right; color: #111827; font-size: 14px;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                        </tr>
                      </table>
                    </div>
                    <div style="text-align: center; margin-top: 24px;">
                      <a href="${appUrl}/invoice/${proposal.id}" style="display: inline-block; background-color: #293745; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">View Full Invoice</a>
                    </div>
                    <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 32px; margin-bottom: 0;">
                      Powered by StoryPay & LunarPay
                    </p>
                  </div>
                </div>
              `,
            }),
          });
          console.log('Receipt email sent to', fullProposal.customer_email);
        }
      }
    } catch (emailErr) {
      console.error('Failed to send receipt email (payment still succeeded):', emailErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Verify payment error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to verify payment' },
      { status: 500 }
    );
  }
}
