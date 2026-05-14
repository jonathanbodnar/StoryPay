import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createIntention } from '@/lib/lunarpay';

interface InstallmentConfig { installments: Array<{ amount: number; date: string }>; }
interface SubscriptionConfig { amount: number; frequency: string; start_date: string; }

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, venue_id, status, price, accept_ach, payment_type, payment_config, template_id')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  // Invoices have no template_id (same logic as the public proposals GET route)
  const isInvoice = !proposal.template_id;
  const allowedStatuses = isInvoice ? ['sent', 'opened', 'signed'] : ['signed'];
  if (!allowedStatuses.includes(proposal.status as string)) {
    return NextResponse.json({ error: 'Proposal not ready for payment' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_publishable_key, accept_ach, service_fee_rate')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_publishable_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  const proposalAch = (proposal as { accept_ach?: boolean | null }).accept_ach;
  const venueAch    = (venue as { accept_ach?: boolean | null }).accept_ach;
  const acceptAch   = proposalAch !== null && proposalAch !== undefined ? proposalAch !== false : venueAch !== false;

  const feeRate = Number((venue as Record<string, unknown>).service_fee_rate ?? 0);
  const applyFee = (cents: number) => feeRate > 0 ? Math.round(cents * (1 + feeRate / 100)) : cents;

  // Determine payment type details
  const paymentType = (proposal.payment_type as string) || 'full';
  const config = proposal.payment_config as Record<string, unknown> | null;

  const isTrial = paymentType === 'subscription' && (() => {
    const sd = (config as SubscriptionConfig | null)?.start_date;
    return Boolean(sd && new Date(sd) > new Date());
  })();

  let amountCents = proposal.price as number;
  if (paymentType === 'installment') {
    const ic = config as InstallmentConfig | null;
    amountCents = ic?.installments?.[0]?.amount ?? (proposal.price as number);
  } else if (paymentType === 'subscription') {
    const sc = config as SubscriptionConfig | null;
    amountCents = sc?.amount ?? (proposal.price as number);
  }
  const displayAmountCents = isTrial ? 0 : applyFee(amountCents);

  try {
    // Per LP docs (May 2026): the ticket from `ticket_success` can ONLY be
    // used to save the card via POST /customers/:id/payment-methods. Real
    // charges go through POST /charges with the resulting paymentMethodId.
    // So ALL paid flows use hasRecurring:true; only trials use savePaymentMethod.
    //
    // The intention `amount` is what Fortis Elements displays as the total
    // and authorizes — it MUST match what we'll actually charge (incl. fee),
    // otherwise the charge fails or is short.
    const intentionResult = await createIntention(
      venue.lunarpay_publishable_key,
      isTrial ? undefined : displayAmountCents,
      {
        paymentMethods:    acceptAch ? ['cc', 'ach'] : ['cc'],
        hasRecurring:      isTrial ? undefined : true,
        savePaymentMethod: isTrial ? true : undefined,
      },
    );
    const intention = (intentionResult as Record<string, unknown>).data || intentionResult;

    return NextResponse.json({
      clientToken:      (intention as Record<string, unknown>).clientToken,
      environment:      (intention as Record<string, unknown>).environment ?? 'production',
      amountCents:      displayAmountCents,
      isTrial,
      paymentType,
      paymentMethods:   acceptAch ? ['cc', 'ach'] : ['cc'],
    });
  } catch (err) {
    console.error('Payment intent error:', err);
    return NextResponse.json({ error: 'Failed to create payment intent' }, { status: 500 });
  }
}
