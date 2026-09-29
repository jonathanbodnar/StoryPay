import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { LUNARPAY_PAYMENT_RETIRED_MESSAGE } from '@/lib/lunarpay-retired';
import { stripePublishableKey } from '@/lib/stripe/client';
import { loadConnectVenue, venueTakesStripePayments } from '@/lib/stripe/connect';
import { acceptsBank, firstPaymentCents, payableNow, type PaymentProposal } from '@/lib/stripe/proposal-payments';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('*')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  // Manual-collection records are paid in cash/check directly to the venue —
  // there is no online checkout for them.
  if ((proposal as { collect_manually?: boolean }).collect_manually === true) {
    return NextResponse.json({ error: 'This document is collected directly by the venue.' }, { status: 400 });
  }

  // Invoices have no template_id (same logic as the public proposals GET route)
  const isInvoice = !proposal.template_id;
  const allowedStatuses = isInvoice ? ['sent', 'opened', 'signed'] : ['signed'];
  if (!allowedStatuses.includes(proposal.status as string)) {
    return NextResponse.json({ error: 'Proposal not ready for payment' }, { status: 400 });
  }

  // Venue on Stripe Connect: the page shows Stripe's payment form and confirms
  // through /api/proposals/public/[token]/stripe-pay.
  const connectVenue = await loadConnectVenue(proposal.venue_id as string);
  if (connectVenue && venueTakesStripePayments(connectVenue)) {
    const p = proposal as unknown as PaymentProposal;
    const notPayable = payableNow(p);
    if (notPayable) return NextResponse.json({ error: notPayable }, { status: 400 });
    if (p.payment_processing_at) {
      return NextResponse.json({ error: 'A bank payment for this invoice is already processing.' }, { status: 409 });
    }
    const publishableKey = stripePublishableKey();
    if (!publishableKey) return NextResponse.json({ error: 'Online payments are not configured.' }, { status: 503 });
    const installments = ((p.payment_config as { installments?: unknown[] } | null)?.installments ?? []).length;
    return NextResponse.json({
      provider: 'stripe',
      publishableKey,
      stripeAccount: connectVenue.stripe_account_id,
      amountCents: firstPaymentCents(p),
      paymentType: p.payment_type || 'full',
      paymentMethods: acceptsBank(p, connectVenue) ? ['card', 'us_bank_account'] : ['card'],
      savePaymentMethod: p.payment_type === 'installment' && installments > 1,
      customerName: p.customer_name ?? '',
      customerEmail: p.customer_email ?? '',
    });
  }

  // No other processor: LunarPay is retired (lib/lunarpay-retired.ts), so a
  // venue that hasn't connected Stripe can't take online payments yet.
  return NextResponse.json({ error: LUNARPAY_PAYMENT_RETIRED_MESSAGE }, { status: 409 });
}
