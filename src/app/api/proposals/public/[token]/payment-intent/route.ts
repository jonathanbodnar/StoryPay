import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createIntention } from '@/lib/lunarpay';
import { stripePublishableKey } from '@/lib/stripe/client';
import { loadConnectVenue, venueTakesStripePayments } from '@/lib/stripe/connect';
import { acceptsBank, firstPaymentCents, payableNow, type PaymentProposal } from '@/lib/stripe/proposal-payments';

interface InstallmentConfig { installments: Array<{ amount: number; date: string }>; }

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

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_publishable_key, accept_ach')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_publishable_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  const proposalAch = (proposal as { accept_ach?: boolean | null }).accept_ach;
  const venueAch    = (venue as { accept_ach?: boolean | null }).accept_ach;
  const acceptAch   = proposalAch !== null && proposalAch !== undefined ? proposalAch !== false : venueAch !== false;

  // Only `full` and `installment` are supported for proposals / invoices.
  // Legacy `subscription` rows are blocked here — they should be migrated.
  const paymentType = (proposal.payment_type as string) || 'full';
  if (paymentType !== 'full' && paymentType !== 'installment') {
    return NextResponse.json(
      { error: `Payment type "${paymentType}" is no longer supported. Please recreate the proposal as full or installment.` },
      { status: 400 },
    );
  }

  const config = proposal.payment_config as Record<string, unknown> | null;

  // The proposal price (or installment amount) is the final figure the venue
  // wants to charge — any markup/processing fee was already rolled in when the
  // proposal was created. Charge it as-is. No more fee math here.
  let displayAmountCents: number = proposal.price as number;
  if (paymentType === 'installment') {
    const ic = config as InstallmentConfig | null;
    displayAmountCents = ic?.installments?.[0]?.amount ?? (proposal.price as number);
  }

  const paymentMethods = acceptAch ? ['cc', 'ach'] : ['cc'];

  try {
    // Pick the intention shape that matches the flow per LP /developers docs:
    //  • full        → TRANSACTION intention (amount only). Fortis charges
    //                  inline; backend just records the result.
    //  • installment → TICKET intention (hasRecurring, no amount). Fortis
    //                  tokenizes; backend saves the card, charges the first
    //                  installment, and schedules the rest.
    const intentionResult = await createIntention(
      venue.lunarpay_publishable_key,
      paymentType === 'full' ? displayAmountCents : undefined,
      {
        paymentMethods,
        hasRecurring: paymentType === 'installment' ? true : undefined,
      },
    );
    const intention = (intentionResult as Record<string, unknown>).data || intentionResult;

    return NextResponse.json({
      clientToken:    (intention as Record<string, unknown>).clientToken,
      environment:    (intention as Record<string, unknown>).environment ?? 'production',
      amountCents:    displayAmountCents,
      paymentType,
      paymentMethods,
    });
  } catch (err) {
    console.error('[proposal payment-intent] LP intention failed:', err);
    const msg = err instanceof Error ? err.message : 'Failed to create payment intent';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
