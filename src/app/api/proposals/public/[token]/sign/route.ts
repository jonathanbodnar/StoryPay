import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { syncPaymentRemindersForProposal } from '@/lib/payment-reminders';
import { notifyOwner, formatAmount } from '@/lib/owner-notifications';

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
    .select('id, status, venue_id, customer_name, price')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (proposal.status !== 'sent' && proposal.status !== 'opened') {
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
  if (proposal.venue_id) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
    void notifyOwner({
      venueId: proposal.venue_id as string,
      scenario: 'proposal_signed',
      vars: {
        customer_name: (proposal.customer_name as string | null) || 'Customer',
        amount:        formatAmount(proposal.price as number | null),
      },
      actionUrl: `${appUrl}/dashboard/payments/proposals`,
    });
  }

  return NextResponse.json({ success: true });
}
