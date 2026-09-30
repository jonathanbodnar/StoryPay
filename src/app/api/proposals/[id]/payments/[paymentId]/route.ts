import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { recomputeProposalPaymentStatus } from '@/lib/proposal-payments';
import { rebalanceScheduledInstallments } from '@/lib/stripe/proposal-payments';
import { syncPaymentRemindersForProposal } from '@/lib/payment-reminders';

export const dynamic = 'force-dynamic';

/** Remove a mistakenly-recorded manual payment and recompute the balance. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
  const venueId = (await cookies()).get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, paymentId } = await params;

  const { data: existing } = await supabaseAdmin
    .from('proposal_payments')
    .select('id, source')
    .eq('id', paymentId)
    .eq('proposal_id', id)
    .eq('venue_id', venueId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }
  // A card or bank payment really happened; it's undone with a refund, not deleted.
  if (existing.source === 'online') {
    return NextResponse.json({ error: 'Online payments can’t be removed. Issue a refund instead.' }, { status: 409 });
  }

  const { error } = await supabaseAdmin
    .from('proposal_payments')
    .delete()
    .eq('id', paymentId)
    .eq('venue_id', venueId)
    .neq('source', 'online');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const recompute = await recomputeProposalPaymentStatus(id);
  // On an automatic payment plan, the next payments go back toward their amounts.
  await rebalanceScheduledInstallments(id);
  void syncPaymentRemindersForProposal(id);

  return NextResponse.json({
    deleted: true,
    status: recompute?.status,
    total_paid_cents: recompute?.totalPaidCents ?? 0,
    balance_cents: recompute?.balanceCents ?? 0,
    price_cents: recompute?.priceCents ?? 0,
  });
}
