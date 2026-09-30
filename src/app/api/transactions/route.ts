import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { loadConnectVenue, venueTakesStripePayments } from '@/lib/stripe/connect';
import { planPayments, toYmd } from '@/lib/payment-plan';

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

  if (type === 'schedules') return paymentPlans(venueId);
  return [];
}

/**
 * Every payment plan (the Payment plans page): automatic plans on the venue's
 * Stripe, cash/check plans, and plans waiting on the first payment, with
 * what's paid and the next payment.
 */
async function paymentPlans(venueId: string): Promise<unknown[]> {
  const { data } = await supabaseAdmin
    .from('proposals')
    .select('id, public_token, proposal_number, customer_name, price, status, payment_type, payment_config, payment_provider, collect_manually, created_at')
    .eq('venue_id', venueId)
    .eq('payment_type', 'installment')
    .not('status', 'in', '(draft,cancelled,declined,expired)')
    .order('created_at', { ascending: false });
  const plans = (data ?? []) as Array<{
    id: string; public_token: string | null; proposal_number: number | null; customer_name: string | null; price: number;
    status: string; payment_config: unknown; payment_provider: string | null; collect_manually: boolean | null;
  }>;
  if (!plans.length) return [];
  const ids = plans.map((p) => p.id);
  const [{ data: ledger }, { data: inst }] = await Promise.all([
    supabaseAdmin.from('proposal_payments').select('proposal_id, amount_cents').in('proposal_id', ids),
    supabaseAdmin.from('proposal_installments').select('proposal_id, amount_cents, status, due_date, canceled_reason').in('proposal_id', ids),
  ]);
  const paidBy = new Map<string, number>();
  for (const r of (ledger ?? []) as Array<{ proposal_id: string; amount_cents: number }>) {
    paidBy.set(r.proposal_id, (paidBy.get(r.proposal_id) ?? 0) + (Number(r.amount_cents) || 0));
  }
  type Row = { proposal_id: string; amount_cents: number; status: string; due_date: string; canceled_reason: string | null };
  const rowsBy = new Map<string, Row[]>();
  for (const r of (inst ?? []) as Row[]) {
    rowsBy.set(r.proposal_id, [...(rowsBy.get(r.proposal_id) ?? []), r]);
  }
  const today = new Date().toISOString().slice(0, 10);
  const invNum = (p: { id: string; public_token: string | null; proposal_number: number | null }) =>
    p.proposal_number != null ? String(p.proposal_number) : (p.public_token ?? p.id).slice(0, 8).toUpperCase();

  return plans.map((p) => {
    const total = Math.round(Number(p.price) || 0);
    const paid = paidBy.get(p.id) ?? 0;
    const schedule = planPayments(p.payment_config);
    const rows = rowsBy.get(p.id) ?? [];
    const auto = p.payment_provider === 'stripe' && p.collect_manually !== true && ['paid', 'refunded', 'partial_refund'].includes(p.status);
    let completed: number;
    let count: number;
    let next: { date: string; amount: number } | null = null;
    let status: string;
    if (auto) {
      count = 1 + rows.length;
      completed = 1 + rows.filter((r) => r.status === 'paid' || (r.status === 'canceled' && r.canceled_reason === 'covered')).length;
      const upcoming = rows.filter((r) => r.status === 'scheduled').sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
      if (upcoming) next = { date: String(upcoming.due_date).slice(0, 10), amount: upcoming.amount_cents };
      const waiting = rows.some((r) => ['scheduled', 'processing'].includes(r.status));
      status = paid >= total ? 'completed' : rows.some((r) => r.status === 'failed') ? 'failed' : waiting ? 'active' : 'cancelled';
    } else {
      // Cash/check, or waiting on the first payment: a payment counts once the ledger covers it.
      count = schedule.length;
      let running = 0;
      completed = 0;
      const notStartedOnline = p.collect_manually !== true && paid === 0;
      for (const s of schedule) {
        running += s.amount;
        if (paid >= running) completed++;
        // An online plan's first payment is due when the client signs.
        else if (!next) next = { date: notStartedOnline ? '' : (toYmd(s.date) ?? ''), amount: Math.min(s.amount, running - paid) };
      }
      status = paid >= total && total > 0 ? 'completed' : paid === 0 && p.collect_manually !== true ? 'pending' : next && next.date && next.date < today ? 'overdue' : 'active';
    }
    return {
      id: p.id,
      description: `Invoice #${invNum(p)}`,
      customerId: null,
      customerName: p.customer_name,
      proposalId: p.id,
      proposalStatus: p.status,
      paymentsCompleted: completed,
      paymentsTotal: count,
      paidAmount: paid,
      totalAmount: total,
      nextPaymentDate: next?.date || null,
      nextPaymentAmount: next?.amount ?? null,
      collection: auto ? 'automatic' : p.collect_manually === true ? 'manual' : 'online',
      status,
      effectiveStatus: p.status === 'refunded' || p.status === 'partial_refund' ? p.status : status,
    };
  });
}
