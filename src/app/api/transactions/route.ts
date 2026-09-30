import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { loadConnectVenue, venueTakesStripePayments } from '@/lib/stripe/connect';

export const dynamic = 'force-dynamic';

/** Compute the actual paid amount for a proposal. For installments/subscriptions,
 *  this is the first payment amount from payment_config, not the full invoice total. */
function actualPaidAmountCents(p: { price: number; payment_type: string | null; payment_config: unknown }): number {
  const cfg = (p.payment_config ?? {}) as Record<string, unknown>;
  if (p.payment_type === 'installment' && Array.isArray(cfg.installments)) {
    const installments = cfg.installments as Array<{ amount: number }>;
    if (installments.length > 0) return installments[0].amount;
  }
  if (p.payment_type === 'subscription' && typeof cfg.amount === 'number') {
    return cfg.amount;
  }
  return p.price;
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get('type') || 'charges';

  // Venue on Stripe Connect: everything comes from StoryVenue's own records.
  const connectVenue = await loadConnectVenue(venueId).catch(() => null);
  if (connectVenue && venueTakesStripePayments(connectVenue)) {
    return NextResponse.json(await stripeTransactions(venueId, type));
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', venueId)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'StoryPay™ is not set up yet' }, { status: 400 });
  }

  // LunarPay is retired for venue payments, and these venues' old merchant
  // accounts were never approved (every call came back 403). Show the same
  // records Stripe venues see: StoryVenue's own payment ledger.
  return NextResponse.json(await stripeTransactions(venueId, type));
}


// ── Stripe Connect venues ────────────────────────────────────────────────────

async function stripeTransactions(venueId: string, type: string): Promise<unknown[]> {
  if (type === 'subscriptions') return []; // no recurring subscriptions on Stripe

  const { data: proposals } = await supabaseAdmin
    .from('proposals')
    .select('id, public_token, proposal_number, customer_name, price, status, paid_at, refunded_at, created_at, payment_type, payment_config, payment_provider, stripe_payment_intent_id, transaction_id')
    .eq('venue_id', venueId)
    .in('status', ['paid', 'refunded', 'partial_refund'])
    .order('paid_at', { ascending: false });
  const rows = (proposals ?? []) as Array<Record<string, unknown> & { id: string; public_token: string | null; proposal_number: number | null; price: number; payment_type: string | null; payment_config: unknown; status: string; customer_name: string | null }>;
  const invNum = (p: { id: string; public_token: string | null; proposal_number: number | null }) =>
    p.proposal_number != null ? String(p.proposal_number) : (p.public_token ?? p.id).slice(0, 8).toUpperCase();

  if (type === 'charges') {
    return rows.map((p) => ({
      id: p.id,
      invoiceNumber: invNum(p),
      description: `Invoice #${invNum(p)} - ${p.customer_name}`,
      amount: actualPaidAmountCents(p),
      fullInvoiceAmount: p.price,
      paymentType: p.payment_type,
      status: p.status,
      date: (p.paid_at as string | null) || (p.created_at as string),
      refundedAt: (p.refunded_at as string | null) || null,
      chargeId: (p.stripe_payment_intent_id as string | null) ?? null,
      transactionId: (p.transaction_id as string | null) ?? null,
      sessionId: null,
      customerId: null,
      customerName: p.customer_name,
    }));
  }

  if (type === 'schedules') {
    const plans = rows.filter((p) => p.payment_type === 'installment' && p.payment_provider === 'stripe');
    if (!plans.length) return [];
    const { data: inst } = await supabaseAdmin
      .from('proposal_installments')
      .select('proposal_id, installment_count, amount_cents, status, due_date')
      .in('proposal_id', plans.map((p) => p.id));
    const byProposal = new Map<string, Array<{ installment_count: number; amount_cents: number; status: string; due_date: string }>>();
    for (const r of (inst ?? []) as Array<{ proposal_id: string; installment_count: number; amount_cents: number; status: string; due_date: string }>) {
      byProposal.set(r.proposal_id, [...(byProposal.get(r.proposal_id) ?? []), r]);
    }
    return plans.map((p) => {
      const later = byProposal.get(p.id) ?? [];
      const first = actualPaidAmountCents(p);
      const paidLater = later.filter((r) => r.status === 'paid');
      const total = later[0]?.installment_count ?? 1 + later.length;
      const completed = 1 + paidLater.length;
      const status = later.some((r) => r.status === 'failed')
        ? 'failed'
        : completed >= total
          ? 'completed'
          : 'active';
      const next = later.filter((r) => r.status === 'scheduled').map((r) => r.due_date).sort()[0] ?? null;
      return {
        id: p.id,
        description: `Installment plan #${invNum(p)} — ${completed} of ${total} payments`,
        customerId: null,
        customerName: p.customer_name,
        proposalId: p.id,
        proposalStatus: p.status,
        paymentsCompleted: completed,
        paymentsTotal: total,
        paidAmount: first + paidLater.reduce((s, r) => s + r.amount_cents, 0),
        totalAmount: p.price,
        nextPaymentDate: next,
        status,
        effectiveStatus: p.status === 'refunded' || p.status === 'partial_refund' ? p.status : status,
      };
    });
  }
  return [];
}
