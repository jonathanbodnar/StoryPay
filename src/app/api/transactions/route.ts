import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { listPaymentSchedules, listSubscriptions, listCustomers } from '@/lib/lunarpay';
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
    return NextResponse.json({ error: 'StoryPay merchant account is not yet configured' }, { status: 400 });
  }

  const secret = venue.lunarpay_secret_key;

  try {
    if (type === 'charges') {
      const { data: proposals } = await supabaseAdmin
        .from('proposals')
        .select('id, public_token, customer_name, customer_email, customer_lunarpay_id, price, status, charge_id, checkout_session_id, transaction_id, paid_at, refunded_at, created_at, payment_type, payment_config')
        .eq('venue_id', venueId)
        .in('status', ['paid', 'refunded', 'partial_refund'])
        .order('paid_at', { ascending: false });

      // Map id -> sequential proposal_number (tolerant of pre-migration-156 DBs).
      const numberById = new Map<string, number>();
      try {
        const ids = (proposals ?? []).map((p) => p.id);
        if (ids.length) {
          const { data: nums } = await supabaseAdmin
            .from('proposals')
            .select('id, proposal_number')
            .in('id', ids);
          for (const n of nums ?? []) {
            if (n.proposal_number != null) numberById.set(n.id, Number(n.proposal_number));
          }
        }
      } catch { /* proposal_number column unavailable — fall back to token slice */ }

      const resolved = await Promise.all(
        (proposals ?? []).map(async (p) => {
          let customerId = p.customer_lunarpay_id ?? null;

          if (!customerId && p.customer_email) {
            try {
              const result = await listCustomers(secret, p.customer_email, 1, 1);
              const items = Array.isArray(result) ? result : result.data ?? [];
              if (items.length > 0) {
                customerId = items[0].id;
                await supabaseAdmin
                  .from('proposals')
                  .update({ customer_lunarpay_id: customerId })
                  .eq('id', p.id);
              }
            } catch {
              // best-effort
            }
          }

          const paidAmount = actualPaidAmountCents(p);

          const num = numberById.get(p.id);
          const invNum = num != null
            ? String(num)
            : (p.public_token ? p.public_token.slice(0, 8).toUpperCase() : p.id.slice(0, 8));
          return {
            id: p.id,
            invoiceNumber: invNum,
            description: `Invoice #${invNum} - ${p.customer_name}`,
            amount: paidAmount,
            fullInvoiceAmount: p.price,
            paymentType: p.payment_type,
            status: p.status,
            date: p.paid_at || p.created_at,
            refundedAt: p.refunded_at || null,
            chargeId: p.charge_id,
            transactionId: p.transaction_id,
            sessionId: p.checkout_session_id,
            customerId,
            customerName: p.customer_name,
          };
        })
      );

      return NextResponse.json(resolved);
    }

    if (type === 'schedules') {
      // Build a proposal lookup by payment_schedule_id for customer names + first payment info
      const { data: proposals } = await supabaseAdmin
        .from('proposals')
        .select('id, public_token, customer_name, customer_email, customer_lunarpay_id, payment_schedule_id, price, payment_config, status')
        .eq('venue_id', venueId)
        .not('payment_schedule_id', 'is', null);

      const proposalMap: Record<string, {
        proposalId: string; publicToken: string | null; customerName: string | null; customerId: string | null;
        firstPaymentCents: number; totalPayments: number; totalAmount: number; proposalStatus: string;
      }> = {};
      for (const p of proposals ?? []) {
        if (!p.payment_schedule_id) continue;
        let customerId = p.customer_lunarpay_id ?? null;
        if (!customerId && p.customer_email) {
          try {
            const result = await listCustomers(secret, p.customer_email, 1, 1);
            const items = Array.isArray(result) ? result : result.data ?? [];
            if (items.length > 0) {
              customerId = items[0].id;
              await supabaseAdmin.from('proposals').update({ customer_lunarpay_id: customerId }).eq('id', p.id);
            }
          } catch { /* best-effort */ }
        }
        const cfg = (p.payment_config ?? {}) as { installments?: Array<{ amount: number; date: string }> };
        const installments = cfg.installments ?? [];
        const firstPaymentCents = installments.length > 0 ? installments[0].amount : 0;
        proposalMap[String(p.payment_schedule_id)] = {
          proposalId: p.id,
          publicToken: p.public_token ?? null,
          customerName: p.customer_name ?? null,
          customerId,
          firstPaymentCents,
          totalPayments: installments.length,
          totalAmount: p.price ?? 0,
          proposalStatus: p.status ?? 'unknown',
        };
      }

      // Fetch ALL schedules from LP (active, completed, and cancelled)
      const schedules = await listPaymentSchedules(secret);
      const items = (Array.isArray(schedules) ? schedules : schedules.data ?? []).map(
        (s: Record<string, unknown>) => {
          const linked = proposalMap[String(s.id)];
          const lpPaymentsCompleted = (s.paymentsCompleted as number) ?? 0;
          const lpPaymentsTotal = (s.paymentsTotal as number) ?? 0;
          // The first payment was made at checkout (not through the LP schedule),
          // so add 1 to both completed and total counts for display.
          const displayPaymentsCompleted = linked ? lpPaymentsCompleted + 1 : lpPaymentsCompleted;
          const displayPaymentsTotal = linked ? lpPaymentsTotal + 1 : lpPaymentsTotal;
          const displayPaidAmount = linked ? (s.paidAmount as number ?? 0) + linked.firstPaymentCents : (s.paidAmount as number ?? 0);
          const displayTotalAmount = linked ? (s.totalAmount as number ?? 0) + linked.firstPaymentCents : (s.totalAmount as number ?? 0);
          // Override LP's description (which only covers the schedule portion)
          const displayDescription = linked
            ? `Installment plan #${linked.publicToken ? linked.publicToken.slice(0, 8).toUpperCase() : linked.proposalId.slice(0, 8)} — ${displayPaymentsCompleted} of ${displayPaymentsTotal} payments`
            : (s.description as string) ?? 'Installment plan';

          return {
            ...s,
            description: displayDescription,
            customerId: linked?.customerId ?? null,
            customerName: linked?.customerName ?? null,
            proposalId: linked?.proposalId ?? null,
            proposalStatus: linked?.proposalStatus ?? null,
            // Override with first-payment-inclusive counts
            paymentsCompleted: displayPaymentsCompleted,
            paymentsTotal: displayPaymentsTotal,
            paidAmount: displayPaidAmount,
            totalAmount: displayTotalAmount,
            // If the proposal is refunded/cancelled, reflect that as the effective status
            effectiveStatus: linked?.proposalStatus === 'refunded' || linked?.proposalStatus === 'partial_refund'
              ? linked.proposalStatus
              : s.status as string,
          };
        }
      );
      return NextResponse.json(items);
    }

    if (type === 'subscriptions') {
      // Build a proposal lookup by subscription_id for customer names
      const { data: proposals } = await supabaseAdmin
        .from('proposals')
        .select('id, public_token, customer_name, customer_email, customer_lunarpay_id, subscription_id')
        .eq('venue_id', venueId)
        .not('subscription_id', 'is', null);

      const proposalMap: Record<string, { proposalId: string; publicToken: string | null; customerName: string | null; customerId: string | null }> = {};
      for (const p of proposals ?? []) {
        if (!p.subscription_id) continue;
        let customerId = p.customer_lunarpay_id ?? null;
        if (!customerId && p.customer_email) {
          try {
            const result = await listCustomers(secret, p.customer_email, 1, 1);
            const items = Array.isArray(result) ? result : result.data ?? [];
            if (items.length > 0) {
              customerId = items[0].id;
              await supabaseAdmin.from('proposals').update({ customer_lunarpay_id: customerId }).eq('id', p.id);
            }
          } catch { /* best-effort */ }
        }
        proposalMap[String(p.subscription_id)] = {
          proposalId: p.id,
          publicToken: p.public_token ?? null,
          customerName: p.customer_name ?? null,
          customerId,
        };
      }

      // Fetch ALL subscriptions from LP (active and cancelled)
      const lpSubs = await listSubscriptions(secret);
      const subList = (Array.isArray(lpSubs) ? lpSubs : lpSubs.data ?? []) as Record<string, unknown>[];

      const subscriptions = subList.map((sub) => {
        const linked = proposalMap[String(sub.id)];
        return {
          id: linked?.proposalId ?? null,
          invoiceNumber: linked?.publicToken ? linked.publicToken.slice(0, 8).toUpperCase() : null,
          description: linked?.customerName ? `Invoice #${linked.publicToken ? linked.publicToken.slice(0, 8).toUpperCase() : linked.proposalId.slice(0, 8)} - ${linked.customerName}` : `Subscription #${sub.id}`,
          amount: sub.amount ?? 0,
          frequency: sub.frequency ?? 'monthly',
          status: sub.status ?? 'unknown',
          nextPayment: sub.nextPaymentDate ?? sub.nextPaymentOn ?? null,
          startOn: sub.startOn ?? null,
          subscriptionId: sub.id,
          customerId: linked?.customerId ?? sub.customerId ?? null,
          customerName: linked?.customerName ?? null,
        };
      });

      return NextResponse.json(subscriptions);
    }

    return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
  } catch (err) {
    console.error('Transactions fetch error:', err);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
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
