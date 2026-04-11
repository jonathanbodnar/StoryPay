import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCheckoutSession, createPaymentSchedule, createSubscription } from '@/lib/lunarpay';
import { sendEmail as directSendEmail } from '@/lib/email';
import { getVenueEmailTemplate, buildEmailHtml, fillTemplate } from '@/lib/email-templates';

function applyFee(cents: number, ratePercent: number): number {
  if (ratePercent <= 0) return cents;
  return Math.round(cents * (1 + ratePercent / 100));
}

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
    .select('id, venue_id, status, payment_type, payment_config, customer_name, customer_lunarpay_id, price')
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
    .select('id, lunarpay_secret_key, name, ghl_access_token, ghl_location_id, service_fee_rate')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  try {
    const result = await getCheckoutSession(venue.lunarpay_secret_key, session_id);
    const session = result.data || result;

    console.log('[verify-payment] Checkout session response:', JSON.stringify(session, null, 2));

    if (session.status !== 'completed') {
      return NextResponse.json(
        { error: 'Payment not completed', status: session.status },
        { status: 400 }
      );
    }

    const customerId = session.customer_id || session.customerId || proposal.customer_lunarpay_id;
    const paymentMethodId = session.payment_method_id || session.paymentMethodId || session.payment_method;
    const feeRate = Number(venue.service_fee_rate ?? 0);
    const addFee = feeRate > 0;

    console.log('[verify-payment] customerId:', customerId, 'paymentMethodId:', paymentMethodId);
    console.log('[verify-payment] payment_type:', proposal.payment_type, 'feeRate:', feeRate, '%');
    console.log('[verify-payment] payment_config:', JSON.stringify(proposal.payment_config));

    const updateData: Record<string, unknown> = {
      status: 'paid',
      paid_at: session.paid_at || session.paidAt || new Date().toISOString(),
      checkout_session_id: session_id,
      transaction_id: session.transaction_id || session.transactionId || null,
    };

    if (proposal.payment_type === 'installment' && proposal.payment_config) {
      const config = proposal.payment_config as InstallmentConfig;
      const allInstallments = config.installments || [];
      const remaining = allInstallments.slice(1);

      console.log('[verify-payment] Total installments:', allInstallments.length, 'Remaining:', remaining.length);

      if (remaining.length > 0) {
        if (!customerId) {
          console.error('[verify-payment] Cannot create payment schedule: no customer_id from checkout session or proposal');
        } else if (!paymentMethodId) {
          console.error('[verify-payment] Cannot create payment schedule: no payment_method_id from checkout session');
          console.log('[verify-payment] Full session keys:', Object.keys(session));
        } else {
          try {
            const schedulePayload = {
              customerId: Number(customerId),
              paymentMethodId: Number(paymentMethodId),
              description: `${proposal.customer_name} - Installment plan`,
              payments: remaining.map((p) => ({
                amount: addFee ? applyFee(p.amount, feeRate) : p.amount,
                date: p.date,
              })),
            };

            console.log('[verify-payment] Creating payment schedule:', JSON.stringify(schedulePayload, null, 2));

            const scheduleResult = await createPaymentSchedule(venue.lunarpay_secret_key, schedulePayload);
            const schedule = scheduleResult.data || scheduleResult;

            console.log('[verify-payment] Payment schedule created:', JSON.stringify(schedule));
            updateData.payment_schedule_id = schedule.id;
          } catch (scheduleErr) {
            console.error('[verify-payment] Failed to create payment schedule:', scheduleErr);
            console.error('[verify-payment] Error details:', scheduleErr instanceof Error ? scheduleErr.message : String(scheduleErr));
          }
        }
      }
    }

    if (proposal.payment_type === 'subscription' && proposal.payment_config) {
      const config = proposal.payment_config as SubscriptionConfig;

      if (!customerId || !paymentMethodId) {
        console.error('[verify-payment] Cannot create subscription: customerId=', customerId, 'paymentMethodId=', paymentMethodId);
      } else {
        try {
          const subPayload = {
            customerId: Number(customerId),
            paymentMethodId: Number(paymentMethodId),
            amount: addFee ? applyFee(config.amount, feeRate) : config.amount,
            frequency: config.frequency,
            startOn: config.start_date,
            description: `${proposal.customer_name} - ${config.frequency} subscription`,
          };

          console.log('[verify-payment] Creating subscription:', JSON.stringify(subPayload, null, 2));

          const subResult = await createSubscription(venue.lunarpay_secret_key, subPayload);
          const sub = subResult.data || subResult;
          updateData.subscription_id = sub.id;
          console.log('[verify-payment] Subscription created:', sub.id);
        } catch (subErr) {
          console.error('[verify-payment] Failed to create subscription:', subErr);
        }
      }
    }

    await supabaseAdmin
      .from('proposals')
      .update(updateData)
      .eq('id', proposal.id);

    console.log('[verify-payment] Proposal updated:', JSON.stringify(updateData));

    // Send payment confirmation email using the venue's saved template
    try {
      const { data: fullProposal } = await supabaseAdmin
        .from('proposals')
        .select('customer_email, customer_name, price, public_token')
        .eq('id', proposal.id)
        .single();

      if (fullProposal?.customer_email && venue?.id) {
        const { data: brandData } = await supabaseAdmin
          .from('venues')
          .select('brand_color, brand_logo_url')
          .eq('id', venue.id)
          .single();

        const tmpl = await getVenueEmailTemplate(venue.id, 'payment_confirmation');
        if (tmpl) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
          const venueName = venue.name || 'Your Venue';
          const amountFormatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
            .format((fullProposal.price || 0) / 100);
          const invoiceUrl = `${appUrl}/proposal/${fullProposal.public_token}`;
          const vars: Record<string, string> = {
            organization:   venueName,
            customer_name:  fullProposal.customer_name || 'there',
            amount:         amountFormatted,
            date:           new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            payment_method: '',
          };

          await directSendEmail({
            to: fullProposal.customer_email,
            subject: fillTemplate(tmpl.subject, vars),
            html: buildEmailHtml({
              template:   tmpl,
              vars,
              actionUrl:  invoiceUrl,
              brandColor: brandData?.brand_color   || '#1b1b1b',
              logoUrl:    brandData?.brand_logo_url || undefined,
              venueName,
            }),
          });
          console.log('[verify-payment] Receipt email sent to', fullProposal.customer_email);
        }
      }
    } catch (emailErr) {
      console.error('[verify-payment] Failed to send receipt email:', emailErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[verify-payment] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to verify payment' },
      { status: 500 }
    );
  }
}
