import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail as directSendEmail } from '@/lib/email';
import { getVenueEmailTemplate, buildEmailHtml, fillTemplate } from '@/lib/email-templates';

export type ManualPaymentMethod = 'cash' | 'check' | 'other';

export interface ProposalPaymentRow {
  id: string;
  proposal_id: string;
  venue_id: string;
  amount_cents: number;
  method: ManualPaymentMethod;
  check_number: string | null;
  note: string | null;
  recorded_by: string | null;
  paid_at: string;
  created_at: string;
}

/** Human-readable label for a manual payment method, e.g. "Check #1042". */
export function methodLabel(method: string, checkNumber?: string | null): string {
  if (method === 'check') return checkNumber ? `Check #${checkNumber}` : 'Check';
  if (method === 'cash') return 'Cash';
  return 'Manual payment';
}

/** Sum of all manual payments recorded against a proposal/invoice (in cents). */
export async function sumManualPayments(proposalId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('proposal_payments')
    .select('amount_cents')
    .eq('proposal_id', proposalId);
  return (data ?? []).reduce((acc, r) => acc + (Number(r.amount_cents) || 0), 0);
}

interface RecomputeResult {
  status: string;
  totalPaidCents: number;
  balanceCents: number;
  priceCents: number;
}

/**
 * Recompute a proposal's status from its manual-payment ledger and persist it.
 *
 *  • paid in full        → status 'paid'      (+ paid_at stamped)
 *  • partial balance     → status 'partially_paid'
 *  • no manual payments  → revert to its pre-payment lifecycle state
 *
 * Online (LunarPay) payments still flip status to 'paid' through the existing
 * verify-payment route; this only governs the manual ledger.
 */
export async function recomputeProposalPaymentStatus(proposalId: string): Promise<RecomputeResult | null> {
  const { data: proposal } = await supabaseAdmin
    .from('proposals')
    .select('id, price, status, template_id, signed_at, sent_at, paid_at')
    .eq('id', proposalId)
    .single();

  if (!proposal) return null;

  const priceCents = Number(proposal.price) || 0;
  const totalPaidCents = await sumManualPayments(proposalId);
  const balanceCents = Math.max(priceCents - totalPaidCents, 0);

  // Never downgrade a proposal that was already settled online.
  if (proposal.status === 'refunded' || proposal.status === 'partial_refund') {
    return { status: proposal.status, totalPaidCents, balanceCents, priceCents };
  }

  let nextStatus: string;
  const update: Record<string, unknown> = {};

  if (priceCents > 0 && totalPaidCents >= priceCents) {
    nextStatus = 'paid';
    if (!proposal.paid_at) update.paid_at = new Date().toISOString();
  } else if (totalPaidCents > 0) {
    nextStatus = 'partially_paid';
    update.paid_at = null;
  } else {
    // No manual payments left — fall back to the natural lifecycle state.
    nextStatus = proposal.signed_at ? 'signed' : proposal.sent_at ? 'opened' : 'sent';
    update.paid_at = null;
  }

  update.status = nextStatus;

  await supabaseAdmin.from('proposals').update(update).eq('id', proposalId);

  return { status: nextStatus, totalPaidCents, balanceCents, priceCents };
}

interface ReceiptArgs {
  venueId: string;
  customerEmail: string;
  customerName: string | null;
  publicToken: string | null;
  amountCents: number;
  method: string;
  checkNumber?: string | null;
  balanceCents: number;
}

/**
 * Send the client a branded receipt for a manually-recorded cash/check
 * payment. Reuses the venue's `payment_confirmation` template so it matches
 * online receipts. Swallows its own errors — recording the payment must never
 * fail because the email bounced.
 */
export async function sendManualPaymentReceipt(args: ReceiptArgs): Promise<void> {
  const { venueId, customerEmail, customerName, publicToken, amountCents, method, checkNumber, balanceCents } = args;
  if (!customerEmail) return;

  try {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('name, brand_color, brand_logo_url')
      .eq('id', venueId)
      .single();

    const tmpl = await getVenueEmailTemplate(venueId, 'payment_confirmation');
    if (!tmpl) return;

    const venueName = venue?.name || 'Your Venue';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
    const actionUrl = publicToken ? `${appUrl}/proposal/${publicToken}` : undefined;
    const amountStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountCents / 100);
    const balanceStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(balanceCents / 100);

    const vars: Record<string, string> = {
      organization:   venueName,
      customer_name:  customerName || 'there',
      amount:         amountStr,
      date:           new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      payment_method: methodLabel(method, checkNumber),
      balance_due:    balanceStr,
    };

    await directSendEmail({
      to:      customerEmail,
      subject: fillTemplate(tmpl.subject, vars),
      html:    buildEmailHtml({
        template:   tmpl,
        vars,
        actionUrl,
        brandColor: venue?.brand_color || '#1b1b1b',
        logoUrl:    venue?.brand_logo_url || undefined,
        venueName,
      }),
    });
  } catch (err) {
    console.error('[manual-payment] receipt email failed:', err);
  }
}
