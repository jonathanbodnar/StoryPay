import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCheckoutSession } from '@/lib/lunarpay';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';

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

function applyFee(cents: number, ratePercent: number): number {
  if (ratePercent <= 0) return cents;
  return Math.round(cents * (1 + ratePercent / 100));
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, venue_id, status, price, customer_name, customer_email, customer_lunarpay_id, payment_type, payment_config, accept_ach')
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
    .select('id, name, lunarpay_secret_key, service_fee_rate, accept_ach')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  const feeRate = Number(venue.service_fee_rate ?? 0);
  const addFee = feeRate > 0;
  // Proposal-level accept_ach takes precedence. Falls back to venue-level setting.
  const proposalAch = (proposal as { accept_ach?: boolean | null }).accept_ach;
  const venueAch = (venue as { accept_ach?: boolean | null }).accept_ach;
  const acceptAch = proposalAch !== null && proposalAch !== undefined ? proposalAch !== false : venueAch !== false;

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

    const finalCents = addFee ? applyFee(chargeAmountCents, feeRate) : chargeAmountCents;
    const amountInDollars = finalCents / 100;

    const checkoutData: Record<string, unknown> = {
      amount: amountInDollars,
      description,
      customer_email: proposal.customer_email,
      customer_name: proposal.customer_name,
      metadata: {
        storypay_proposal_id: proposal.id,
        storypay_venue_id: venue.id,
        public_token: token,
        payment_type: proposal.payment_type || 'one_time',
      },
      success_url: `${APP_URL}/proposal/${token}/success`,
      cancel_url: `${APP_URL}/proposal/${token}`,
    };

    // Wire up mode + recurring/installments so LP creates the plan in one call
    // instead of orphan one-off charges per period.
    if (proposal.payment_type === 'subscription' && proposal.payment_config) {
      const config = proposal.payment_config as SubscriptionConfig;
      checkoutData.mode = 'subscription';
      checkoutData.recurring = {
        frequency: config.frequency || 'monthly',
        ...(config.start_date ? { start_date: config.start_date } : {}),
      };
    } else if (proposal.payment_type === 'installment' && proposal.payment_config) {
      const config = proposal.payment_config as InstallmentConfig;
      const installments = config.installments || [];
      if (installments.length > 1) {
        checkoutData.mode = 'installments';
        checkoutData.installments = {
          count: installments.length,
          frequency: 'monthly',
        };
      }
    }

    // Explicitly send payment_methods so LP shows the correct tabs.
    checkoutData.payment_methods = acceptAch ? ['cc', 'ach'] : ['cc'];

    console.log('[checkout] feeRate:', feeRate, '% originalCents:', chargeAmountCents, 'finalCents:', finalCents, 'acceptAch:', acceptAch);
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
