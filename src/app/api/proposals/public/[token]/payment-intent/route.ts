import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createIntention } from '@/lib/lunarpay';

interface InstallmentConfig { installments: Array<{ amount: number; date: string }>; }

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
