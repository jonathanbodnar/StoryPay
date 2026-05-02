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
    .select('name, lunarpay_secret_key, service_fee_rate, accept_ach')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  const feeRate = Number(venue.service_fee_rate ?? 0);
  const addFee = feeRate > 0;
  // Only override payment_methods when the venue has explicitly opted OUT
  // of ACH. When the toggle is ON (or unset), we omit payment_methods so
  // LunarPay's hosted page falls back to its default (cc + ach when the
  // Fortis account has both enabled, cc-only otherwise). Sending the field
  // explicitly was triggering 500s from LunarPay for some merchant configs.
  const acceptAch = (venue as { accept_ach?: boolean | null }).accept_ach !== false;

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

    const hasFuturePayments = proposal.payment_type === 'installment' || proposal.payment_type === 'subscription';

    const checkoutData: Record<string, unknown> = {
      amount: amountInDollars,
      description,
      customer_email: proposal.customer_email,
      customer_name: proposal.customer_name,
      success_url: `${APP_URL}/proposal/${token}/success`,
      cancel_url: `${APP_URL}/proposal/${token}`,
      // Stamp the proposal_id on the LunarPay session so we can match
      // post-settlement webhooks back to the originating proposal.
      metadata: { proposal_id: proposal.id, public_token: token },
    };

    // Restrict to card-only ONLY when the venue has explicitly disabled ACH.
    // Otherwise leave payment_methods unset so LunarPay uses its hosted-page
    // default (which already respects the merchant's Fortis configuration).
    if (!acceptAch) {
      checkoutData.payment_methods = ['cc'];
    }

    if (hasFuturePayments) {
      checkoutData.save_payment_method = true;
    }

    if (proposal.customer_lunarpay_id) {
      checkoutData.customer_id = proposal.customer_lunarpay_id;
    }

    console.log('[checkout] feeRate:', feeRate, '% originalCents:', chargeAmountCents, 'finalCents:', finalCents, 'acceptAch:', acceptAch);
    console.log('[checkout] Creating checkout session:', JSON.stringify(checkoutData));

    // First attempt — full payload.
    // If LunarPay 500s on the metadata or payment_methods extras (some merchant
    // configurations error out instead of ignoring unsupported fields), retry
    // once with a minimal payload so customers can still pay.
    let result;
    try {
      result = await createCheckoutSession(venue.lunarpay_secret_key, checkoutData);
    } catch (lpErr) {
      const msg = lpErr instanceof Error ? lpErr.message : String(lpErr);
      console.warn('[checkout] LP create failed with full payload, retrying without metadata/payment_methods:', msg);
      const minimalData: Record<string, unknown> = {
        amount: checkoutData.amount,
        description: checkoutData.description,
        customer_email: checkoutData.customer_email,
        customer_name: checkoutData.customer_name,
        success_url: checkoutData.success_url,
        cancel_url: checkoutData.cancel_url,
      };
      if (checkoutData.save_payment_method) minimalData.save_payment_method = true;
      if (checkoutData.customer_id !== undefined) minimalData.customer_id = checkoutData.customer_id;
      result = await createCheckoutSession(venue.lunarpay_secret_key, minimalData);
    }
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
