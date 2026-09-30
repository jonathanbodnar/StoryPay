/**
 * Refunds on a venue's Stripe account, one payment at a time. SERVER-ONLY.
 *
 * Every online payment is a row in the payment ledger (proposal_payments,
 * reference = its PaymentIntent). A refund is recorded on that row as
 * refunded_cents, always read back from Stripe (the charge's amount_refunded),
 * so a refund from the app and one from the venue's own Stripe dashboard land
 * the same way and are never counted twice.
 *
 * A refund is a credit: the couple is never charged that amount again, because
 * balances keep summing what was paid before refunds. The booking reads
 * "refunded" once everything paid has been refunded (the remaining automatic
 * payments then stop), otherwise "partial_refund", and a payment plan keeps
 * running unless the venue chooses to cancel the rest.
 */

import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe/client';
import { loadConnectVenue } from '@/lib/stripe/connect';
import { applySystemTagByEmail, ensureSystemTagsForVenue } from '@/lib/system-tags';
import { formatAmount, notifyOwner } from '@/lib/owner-notifications';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');

/** Proposal statuses a refund can change (never a draft or a canceled deal). */
const REFUNDABLE_STATUSES = ['paid', 'partially_paid', 'partial_refund', 'refunded'];

interface LedgerRow {
  id: string;
  proposal_id: string;
  venue_id: string;
  amount_cents: number;
  refunded_cents: number | null;
  source: string | null;
  reference: string | null;
}

/** Record how much of a payment has been refunded (Stripe's running total for its charge). */
async function setRefunded(row: Pick<LedgerRow, 'id' | 'amount_cents' | 'refunded_cents'>, amountRefunded: number): Promise<boolean> {
  const refunded = Math.max(0, Math.min(Math.round(amountRefunded), Number(row.amount_cents)));
  if (refunded === Number(row.refunded_cents ?? 0)) return false;
  await supabaseAdmin
    .from('proposal_payments')
    .update({ refunded_cents: refunded, refunded_at: new Date().toISOString() })
    .eq('id', row.id);
  return true;
}

/**
 * Keep the booking's status in step with its refunds: "refunded" when all of
 * it has been refunded (and the remaining automatic payments stop), otherwise
 * "partial_refund". Returns the status now on the booking.
 */
export async function applyRefundStatus(proposalId: string): Promise<'refunded' | 'partial_refund' | null> {
  const { data } = await supabaseAdmin.from('proposal_payments').select('amount_cents, refunded_cents').eq('proposal_id', proposalId);
  const rows = (data ?? []) as Array<{ amount_cents: number; refunded_cents: number | null }>;
  const paid = rows.reduce((s, r) => s + (Number(r.amount_cents) || 0), 0);
  const refunded = rows.reduce((s, r) => s + (Number(r.refunded_cents) || 0), 0);
  if (refunded <= 0) return null;
  const status = refunded >= paid ? 'refunded' : 'partial_refund';
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('proposals')
    .update({ status, refunded_at: now })
    .eq('id', proposalId)
    .in('status', REFUNDABLE_STATUSES);
  if (status === 'refunded') {
    // Everything paid went back: nothing more is charged automatically.
    await supabaseAdmin
      .from('proposal_installments')
      .update({ status: 'canceled', canceled_reason: 'refunded', updated_at: now })
      .eq('proposal_id', proposalId)
      .in('status', ['scheduled', 'failed']);
  }
  return status;
}

/** Stop a plan's remaining automatic payments (the venue chose to, e.g. the wedding is off). */
async function cancelRemainingPayments(proposalId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('proposal_installments')
    .update({ status: 'canceled', canceled_reason: 'plan_canceled', updated_at: new Date().toISOString() })
    .eq('proposal_id', proposalId)
    .in('status', ['scheduled', 'failed'])
    .select('id');
  return data?.length ?? 0;
}

export type RefundResult =
  | { ok: true; refundedCents: number; fullRefund: boolean; message: string }
  | { ok: false; error: string };

/**
 * Refund one online payment, fully or in part, on the venue's Stripe account.
 * StoryVenue's fee on it is refunded in proportion; Stripe keeps its own fee.
 */
export async function refundPayment(args: {
  venueId: string;
  proposalId: string;
  paymentId: string;
  /** Omit for the full refundable amount. */
  amountCents?: number | null;
  /** Also stop the plan's remaining automatic payments. */
  cancelRemaining?: boolean;
}): Promise<RefundResult> {
  const { data } = await supabaseAdmin
    .from('proposal_payments')
    .select('id, proposal_id, venue_id, amount_cents, refunded_cents, source, reference')
    .eq('id', args.paymentId)
    .eq('proposal_id', args.proposalId)
    .eq('venue_id', args.venueId)
    .maybeSingle();
  const row = data as LedgerRow | null;
  if (!row) return { ok: false, error: 'Payment not found.' };
  if (row.source !== 'online' || !row.reference?.startsWith('pi_')) {
    return { ok: false, error: 'Only card and bank payments made online can be refunded here. Remove a cash or check record instead.' };
  }
  const refundable = Number(row.amount_cents) - Number(row.refunded_cents ?? 0);
  if (refundable <= 0) return { ok: false, error: 'This payment has already been refunded in full.' };
  const amount = args.amountCents == null ? refundable : Math.round(Number(args.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter a refund amount greater than $0.' };
  if (amount > refundable) return { ok: false, error: `You can refund up to ${formatAmount(refundable)} of this payment.` };

  const { data: prop } = await supabaseAdmin
    .from('proposals')
    .select('id, status, customer_name, customer_email')
    .eq('id', row.proposal_id)
    .maybeSingle();
  const p = prop as { id: string; status: string; customer_name: string | null; customer_email: string | null } | null;
  if (!p) return { ok: false, error: 'Booking not found.' };

  const v = await loadConnectVenue(args.venueId);
  if (!v?.stripe_account_id) return { ok: false, error: 'Your Stripe account isn’t connected, so this refund has to be made in Stripe.' };
  const account = v.stripe_account_id;
  const stripe = getStripe();

  try {
    await stripe.refunds.create(
      {
        payment_intent: row.reference,
        amount,
        refund_application_fee: true,
        metadata: { storyvenue_proposal_id: row.proposal_id, storyvenue_payment_id: row.id },
      },
      // The same click twice returns the same refund; a later refund gets its own key.
      { stripeAccount: account, idempotencyKey: `sv-refund-${row.id}-${row.refunded_cents ?? 0}-${amount}` },
    );
  } catch (e) {
    const msg = (e as { message?: string }).message || 'Stripe couldn’t make this refund.';
    console.error('[refunds] refund failed:', msg);
    return { ok: false, error: msg };
  }

  // Read the running refund total back from Stripe (the webhook does the same).
  let recorded = false;
  try {
    const pi = await stripe.paymentIntents.retrieve(row.reference, { expand: ['latest_charge'] }, { stripeAccount: account });
    const charge = pi.latest_charge as Stripe.Charge | null;
    if (charge && typeof charge === 'object') {
      await setRefunded(row, charge.amount_refunded);
      recorded = true;
    }
  } catch (e) {
    console.warn('[refunds] could not read the refund back:', e instanceof Error ? e.message : e);
  }
  if (!recorded) await setRefunded(row, Number(row.refunded_cents ?? 0) + amount);

  const status = await applyRefundStatus(row.proposal_id);
  const canceled = args.cancelRemaining && status !== 'refunded' ? await cancelRemainingPayments(row.proposal_id) : 0;

  const email = p.customer_email?.trim();
  if (email) {
    ensureSystemTagsForVenue(args.venueId).then(() => applySystemTagByEmail(args.venueId, email, 'refunded')).catch(() => {});
  }
  void notifyOwner({
    venueId: args.venueId,
    scenario: 'refund_issued',
    vars: { customer_name: p.customer_name || 'Customer', amount: formatAmount(amount) },
    actionUrl: `${APP_URL}/dashboard/proposals/${row.proposal_id}`,
  });

  const message =
    status === 'refunded'
      ? `Refunded ${formatAmount(amount)}. Everything paid has been refunded, so no more payments will be charged.`
      : canceled
        ? `Refunded ${formatAmount(amount)} and canceled the ${canceled} remaining payment${canceled === 1 ? '' : 's'}.`
        : `Refunded ${formatAmount(amount)}. Your client won’t be charged this amount again.`;
  return { ok: true, refundedCents: amount, fullRefund: status === 'refunded', message };
}

/**
 * Webhook (charge.refunded): a refund made from the app or from the venue's
 * own Stripe dashboard, on any payment. Returns false when the charge isn't
 * one of StoryVenue's recorded payments.
 */
export async function recordChargeRefund(charge: Stripe.Charge): Promise<boolean> {
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return false;
  const { data } = await supabaseAdmin
    .from('proposal_payments')
    .select('id, proposal_id, venue_id, amount_cents, refunded_cents, source, reference')
    .eq('reference', pi)
    .eq('source', 'online');
  const rows = (data ?? []) as LedgerRow[];
  if (!rows.length) return false;
  for (const row of rows) {
    await setRefunded(row, charge.amount_refunded);
    await applyRefundStatus(row.proposal_id);
  }
  return true;
}
