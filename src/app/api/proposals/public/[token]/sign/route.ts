import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { syncPaymentRemindersForProposal } from '@/lib/payment-reminders';
import { notifyOwner, formatAmount } from '@/lib/owner-notifications';
import { dispatchIntegrationEvent } from '@/lib/integration-events';
import { applySystemTagByEmail, ensureSystemTagsForVenue } from '@/lib/system-tags';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { signatureData } = await request.json();

  if (!signatureData) {
    return NextResponse.json({ error: 'Signature data required' }, { status: 400 });
  }

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, status, venue_id, customer_name, customer_email, customer_phone, price, payment_type')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    console.warn('[proposal-sign] proposal not found for token', token);
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  console.log('[proposal-sign] entry', { id: proposal.id, status: proposal.status, venueId: proposal.venue_id });

  if (proposal.status !== 'sent' && proposal.status !== 'opened') {
    // IMPORTANT: if the proposal is already 'signed' or 'paid', we skip the
    // signature insert AND the proposal_signed notification. This is by
    // design — re-signing the same proposal shouldn't re-fire the email.
    // Logged here to make it obvious in the Vercel logs why nothing was sent.
    console.warn('[proposal-sign] skipped — already in state:', proposal.status);
    return NextResponse.json({ error: 'Proposal cannot be signed in current state' }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('proposals')
    .update({
      status: 'signed',
      signature_data: signatureData,
      signed_at: new Date().toISOString(),
    })
    .eq('id', proposal.id);

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save signature' }, { status: 500 });
  }

  void syncPaymentRemindersForProposal(proposal.id);

  // Notify the venue owner that a proposal was signed (gated by toggles).
  //
  // We `await` notifyOwner here (rather than fire-and-forget) because in
  // serverless runtimes (Vercel/Railway) any unfinished promises after the
  // response is returned can be suspended/cancelled — which was silently
  // dropping the proposal_signed email. notifyOwner internally swallows all
  // errors, so awaiting is safe and never blocks the success response from
  // shipping.
  if (proposal.venue_id) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
    await notifyOwner({
      venueId: proposal.venue_id as string,
      scenario: 'proposal_signed',
      vars: {
        customer_name: (proposal.customer_name as string | null) || 'Customer',
        amount:        formatAmount(proposal.price as number | null),
      },
      actionUrl: `${appUrl}/dashboard/payments/proposals`,
    });

    // Fan out to Zapier / external integrations (also awaited for the same
    // serverless-cancellation reason above).
    await dispatchIntegrationEvent(proposal.venue_id as string, 'proposal.signed', {
      proposal: {
        id: proposal.id,
        customer_name: (proposal.customer_name as string | null) || '',
        customer_email: (proposal.customer_email as string | null) || '',
        customer_phone: (proposal.customer_phone as string | null) || '',
        price_cents: (proposal.price as number | null) ?? 0,
        price_dollars: formatAmount(proposal.price as number | null),
        payment_type: (proposal.payment_type as string | null) || 'full',
        signed_at: new Date().toISOString(),
      },
    }).catch(err => console.error('[proposal-sign] dispatchIntegrationEvent', err));

    // Apply proposal_signed + contract_signed system tags (fire-and-forget)
    const signerEmail = (proposal.customer_email as string | null)?.trim();
    if (signerEmail) {
      ensureSystemTagsForVenue(proposal.venue_id as string)
        .then(() => Promise.all([
          applySystemTagByEmail(proposal.venue_id as string, signerEmail, 'proposal_signed'),
          applySystemTagByEmail(proposal.venue_id as string, signerEmail, 'contract_signed'),
        ]))
        .catch(() => {});
    }
  }

  return NextResponse.json({ success: true });
}
