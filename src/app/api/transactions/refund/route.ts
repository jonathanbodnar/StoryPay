import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refundCharge } from '@/lib/lunarpay';
import { applySystemTagByEmail, ensureSystemTagsForVenue } from '@/lib/system-tags';
import { notifyOwner, formatAmount } from '@/lib/owner-notifications';
import { refundPayment } from '@/lib/stripe/refunds';
import { requireOwnerOrAdmin } from '@/lib/session';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const gate = await requireOwnerOrAdmin();
  if (!gate.ok) return gate.res;

  const { proposalId, paymentId, chargeId, amountCents, cancelRemaining } = await request.json();

  if (!proposalId) return NextResponse.json({ error: 'proposalId is required' }, { status: 400 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, stripe_account_id')
    .eq('id', venueId)
    .single();

  const { data: proposal } = await supabaseAdmin
    .from('proposals')
    .select('id, status, charge_id, transaction_id, price, customer_email, customer_name, payment_provider, stripe_payment_intent_id')
    .eq('id', proposalId)
    .eq('venue_id', venueId)
    .single();

  if (!proposal) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  if (proposal.status === 'refunded') return NextResponse.json({ error: 'Already refunded' }, { status: 400 });

  // Paid on the venue's own Stripe account (Stripe Connect): refund one payment
  // there (lib/stripe/refunds.ts). StoryVenue's fee is refunded in proportion;
  // Stripe keeps its own fee.
  if (proposal.payment_provider === 'stripe') {
    let id = typeof paymentId === 'string' ? paymentId : '';
    if (!id) {
      // Older callers name the charge instead: find that payment in the ledger.
      const reference = typeof chargeId === 'string' && chargeId.startsWith('pi_') ? chargeId : proposal.stripe_payment_intent_id;
      const { data: row } = reference
        ? await supabaseAdmin.from('proposal_payments').select('id').eq('proposal_id', proposalId).eq('reference', reference).maybeSingle()
        : { data: null };
      id = (row as { id?: string } | null)?.id ?? '';
    }
    if (!id) return NextResponse.json({ error: 'Choose the payment to refund on the booking page.' }, { status: 400 });
    const result = await refundPayment({
      venueId,
      proposalId,
      paymentId: id,
      amountCents: amountCents ?? null,
      cancelRemaining: cancelRemaining === true,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, refundedAmount: result.refundedCents, fullRefund: result.fullRefund, message: result.message });
  }

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'LunarPay not configured' }, { status: 400 });
  }

  // Prefer the explicit chargeId from the request, then proposal.charge_id,
  // then proposal.transaction_id (older proposals paid through hosted
  // checkout never had charge_id written — the same LP id was only
  // persisted as transaction_id, so the refund still works).
  const resolvedChargeId = chargeId || proposal.charge_id || proposal.transaction_id;
  if (!resolvedChargeId) return NextResponse.json({ error: 'No charge ID found' }, { status: 400 });

  // Validate partial amount
  if (amountCents !== undefined && amountCents !== null) {
    if (amountCents <= 0) return NextResponse.json({ error: 'Refund amount must be greater than $0' }, { status: 400 });
    if (amountCents > (proposal.price ?? 0)) return NextResponse.json({ error: 'Refund amount cannot exceed original charge' }, { status: 400 });
  }

  try {
    const result = await refundCharge(
      venue.lunarpay_secret_key,
      resolvedChargeId,
      amountCents ?? undefined
    );

    // Update proposal status: 'refunded' for full, 'partial_refund' for partial
    const isFullRefund = !amountCents || amountCents >= (proposal.price ?? 0);
    const newStatus = isFullRefund ? 'refunded' : 'partial_refund';
    const { error: updateError } = await supabaseAdmin
      .from('proposals')
      .update({ status: newStatus, refunded_at: new Date().toISOString() })
      .eq('id', proposalId);
    if (updateError) {
      console.error('Refund DB update failed:', updateError);
      return NextResponse.json({ error: 'Failed to update proposal status' }, { status: 500 });
    }

    // Apply refunded system tag (fire-and-forget)
    const refundEmail = (proposal.customer_email as string | null)?.trim();
    if (refundEmail) {
      ensureSystemTagsForVenue(venueId)
        .then(() => applySystemTagByEmail(venueId, refundEmail, 'refunded'))
        .catch(() => {});
    }

    // Notify the owner/team (gated per-person by their refund_issued
    // email/SMS/push toggles — see src/lib/notification-settings.ts). This
    // was previously defined but never fired, so the toggle was a no-op.
    const refundedAmountCents = result?.refundedAmount ?? amountCents ?? proposal.price ?? 0;
    void notifyOwner({
      venueId,
      scenario: 'refund_issued',
      vars: {
        customer_name: (proposal.customer_name as string | null) || 'Customer',
        amount:        formatAmount(refundedAmountCents),
      },
      actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io'}/dashboard/transactions`,
    });

    return NextResponse.json({
      success: true,
      refundedAmount: result?.refundedAmount ?? amountCents ?? proposal.price,
      fullRefund: isFullRefund,
    });
  } catch (err) {
    console.error('Refund error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Refund failed' }, { status: 500 });
  }
}
