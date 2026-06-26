import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { recomputeProposalPaymentStatus } from '@/lib/proposal-payments';

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
    .select('id')
    .eq('id', paymentId)
    .eq('proposal_id', id)
    .eq('venue_id', venueId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from('proposal_payments')
    .delete()
    .eq('id', paymentId)
    .eq('venue_id', venueId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const recompute = await recomputeProposalPaymentStatus(id);

  return NextResponse.json({
    deleted: true,
    status: recompute?.status,
    total_paid_cents: recompute?.totalPaidCents ?? 0,
    balance_cents: recompute?.balanceCents ?? 0,
    price_cents: recompute?.priceCents ?? 0,
  });
}
