import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCheckoutSession } from '@/lib/lunarpay';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
const SERVICE_FEE_RATE = 0.01;

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

function applyFee(cents: number): number {
  return Math.round(cents * (1 + SERVICE_FEE_RATE));
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, venue_id, status, price, customer_name, customer_email, customer_lunarpay_id, payment_type, payment_config')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (proposal.status !== 'signed') {
    return NextResponse.json({ error: 'Proposal must be signed before payment' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, lunarpay_secret_key, pass_service_fee')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  const addFee = venue.pass_service_fee === true;

  try {
    let chargeAmountCents = proposal.price;
    let description = `${venue.name} - Proposal Payment`;

    if (proposal.payment_type === 'installment' && proposal.payment_config) {
      const config = proposal.payment_config as InstallmentConfig;
      const installments = config.installments || [];
      if (installments.length > 0) {
        chargeAmountCents = installments[0].amount;
        description = `${venue.name} - Payment 1 of ${installments.length}`;
      }
    } else if (proposal.payment_type === 'subscription' && proposal.payment_config) {
      const config = proposal.payment_config as SubscriptionConfig;
      if (config.amount) {
        chargeAmountCents = config.amount;
        description = `${venue.name} - First ${config.frequency} payment`;
      }
    }

    const finalCents = addFee ? applyFee(chargeAmountCents) : chargeAmountCents;
    const amountInDollars = finalCents / 100;

    const hasFuturePayments = proposal.payment_type === 'installment' || proposal.payment_type === 'subscription';

    const checkoutData: Record<string, unknown> = {
      amount: amountInDollars,
      description,
      customer_email: proposal.customer_email,
      customer_name: proposal.customer_name,
      success_url: `${APP_URL}/proposal/${token}/success`,
      cancel_url: `${APP_URL}/proposal/${token}`,
    };

    if (hasFuturePayments) {
      checkoutData.save_payment_method = true;
    }

    if (proposal.customer_lunarpay_id) {
      checkoutData.customer_id = proposal.customer_lunarpay_id;
    }

    console.log('[checkout] addFee:', addFee, 'originalCents:', chargeAmountCents, 'finalCents:', finalCents);
    console.log('[checkout] Creating checkout session:', JSON.stringify(checkoutData));

    const result = await createCheckoutSession(venue.lunarpay_secret_key, checkoutData);
    const session = result.data || result;

    console.log('[checkout] Session created:', JSON.stringify(session));

    if (!session.url) {
      console.error('[checkout] No URL in response:', JSON.stringify(result));
      return NextResponse.json({ error: 'No payment URL returned' }, { status: 500 });
    }

    return NextResponse.json({ url: session.url, service_fee_applied: addFee });
  } catch (err) {
    console.error('[checkout] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
