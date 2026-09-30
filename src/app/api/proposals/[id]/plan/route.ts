import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { loadConnectVenue } from '@/lib/stripe/connect';
import { managePaymentPlan, paymentMethodLabel, type PlanAction } from '@/lib/stripe/proposal-payments';
import { planPayments, toYmd } from '@/lib/payment-plan';
import { syncPaymentRemindersForProposal } from '@/lib/payment-reminders';

export const dynamic = 'force-dynamic';

interface PlanRow {
  id: string;
  installment_number: number;
  amount_cents: number;
  planned_amount_cents: number | null;
  due_date: string;
  status: string;
  attempts: number;
  last_error: string | null;
  canceled_reason: string | null;
  paid_at: string | null;
  heads_up_sent_at: string | null;
}

/**
 * GET /api/proposals/[id]/plan — the payment plan for the venue's plan tools:
 * every payment with its status, what's paid and owed, and the card on file.
 * Automatic plans (Stripe) come from their scheduled payments; cash/check
 * plans from the schedule, marked paid as the ledger covers each payment.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = (await cookies()).get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { data: proposal } = await supabaseAdmin
    .from('proposals')
    .select('id, status, price, payment_type, payment_config, payment_provider, collect_manually, customer_email, stripe_payment_method_id, paid_at, payment_processing_at')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const p = proposal as {
    id: string; status: string; price: number; payment_type: string | null; payment_config: unknown;
    payment_provider: string | null; collect_manually: boolean | null; customer_email: string | null;
    stripe_payment_method_id: string | null; paid_at: string | null; payment_processing_at: string | null;
  };
  if (p.payment_type !== 'installment') return NextResponse.json({ plan: null });

  const [{ data: ledger }, { data: rowData }] = await Promise.all([
    supabaseAdmin.from('proposal_payments').select('amount_cents').eq('proposal_id', p.id),
    supabaseAdmin
      .from('proposal_installments')
      .select('id, installment_number, amount_cents, planned_amount_cents, due_date, status, attempts, last_error, canceled_reason, paid_at, heads_up_sent_at')
      .eq('proposal_id', p.id)
      .order('installment_number', { ascending: true }),
  ]);
  const paidCents = ((ledger ?? []) as Array<{ amount_cents: number }>).reduce((s, r) => s + (Number(r.amount_cents) || 0), 0);
  const priceCents = Math.round(Number(p.price) || 0);
  const schedule = planPayments(p.payment_config);
  const rows = (rowData ?? []) as PlanRow[];
  const auto = p.payment_provider === 'stripe' && p.collect_manually !== true && (rows.length > 0 || p.status === 'paid');
  const today = new Date().toISOString().slice(0, 10);

  let payments: Array<Record<string, unknown>>;
  if (auto) {
    const first = schedule[0];
    payments = [
      {
        id: null,
        number: 1,
        amount_cents: first ? first.amount : null,
        due_date: p.paid_at ? p.paid_at.slice(0, 10) : toYmd(first?.date) ?? null,
        status: p.status === 'paid' ? 'paid' : p.payment_processing_at ? 'processing' : 'due',
        paid_at: p.paid_at,
      },
      ...rows.map((r) => ({
        id: r.id,
        number: r.installment_number,
        amount_cents: r.amount_cents,
        planned_amount_cents: r.planned_amount_cents,
        due_date: String(r.due_date).slice(0, 10),
        status: r.status === 'canceled' && r.canceled_reason === 'covered' ? 'covered' : r.status,
        attempts: r.attempts,
        last_error: r.last_error,
        paid_at: r.paid_at,
        heads_up_sent: !!r.heads_up_sent_at,
      })),
    ];
  } else {
    // Cash/check (or not started): a payment is paid once the ledger covers it.
    // An online plan's first payment is due when the client signs, so it's
    // never "overdue" here; the rest start once that's paid.
    const notStartedOnline = p.collect_manually !== true && paidCents === 0;
    let running = 0;
    payments = schedule.map((s, i) => {
      running += s.amount;
      const date = toYmd(s.date);
      const status = paidCents >= running
        ? 'paid'
        : notStartedOnline
          ? (i === 0 ? 'due' : 'upcoming')
          : date && date < today ? 'overdue' : 'upcoming';
      return { id: null, number: i + 1, amount_cents: s.amount, due_date: notStartedOnline && i === 0 ? null : date, status };
    });
  }

  let card: string | null = null;
  if (auto && p.stripe_payment_method_id) {
    const v = await loadConnectVenue(venueId).catch(() => null);
    if (v?.stripe_account_id) card = await paymentMethodLabel(p, v.stripe_account_id);
  }

  return NextResponse.json({
    plan: {
      auto,
      status: p.status,
      price_cents: priceCents,
      paid_cents: paidCents,
      balance_cents: Math.max(priceCents - paidCents, 0),
      customer_email: p.customer_email,
      card,
      payments,
    },
  });
}

/** POST /api/proposals/[id]/plan — the venue's plan tools (see managePaymentPlan). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const venueId = (await cookies()).get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Partial<PlanAction> & Record<string, unknown>;

  let action: PlanAction;
  switch (body.action) {
    case 'reschedule':
      action = { action: 'reschedule', installmentId: String(body.installmentId ?? ''), date: String(body.date ?? '') };
      break;
    case 'charge_now':
      action = { action: 'charge_now', installmentId: String(body.installmentId ?? '') };
      break;
    case 'push_all':
      action = { action: 'push_all', months: Number(body.months) || 1 };
      break;
    case 'cancel_remaining':
      action = { action: 'cancel_remaining' };
      break;
    case 'send_card_link':
      action = { action: 'send_card_link' };
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const result = await managePaymentPlan(venueId, id, action);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  void syncPaymentRemindersForProposal(id);
  return NextResponse.json(result);
}
