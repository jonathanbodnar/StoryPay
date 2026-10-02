/**
 * Couple payments on a venue's own Stripe account (Stripe Connect direct
 * charges). SERVER-ONLY.
 *
 * Mirrors the LunarPay flow in /api/proposals/public/[token]/pay so nothing
 * downstream changes: the same payment ledger entry, installment reminders,
 * contact tags, owner notification, integration event and receipt email.
 *
 *   • Pay in full / first installment: collected on the proposal page and
 *     confirmed here, where StoryVenue's fee is set for the actual payment
 *     method (card or bank).
 *   • Later installments: charged automatically on their due date from the
 *     card or bank account saved with the first payment (chargeDueInstallments,
 *     run hourly). A failure retries on day 2, 4 and 7 and emails the couple a
 *     link to update their card. A check or cash payment the venue records
 *     lowers the next payments (rebalanceScheduledInstallments), so nothing
 *     is ever charged beyond the balance.
 *   • Bank (ACH) payments take 3–5 business days. The proposal shows
 *     "processing" until Stripe reports success or failure (Connect webhook).
 */

import { randomBytes } from 'node:crypto';
import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe/client';
import {
  applicationFeeCents,
  loadConnectVenue,
  venueTakesStripePayments,
  type ConnectVenue,
  type PaymentKind,
} from '@/lib/stripe/connect';
import { sendEmail as directSendEmail } from '@/lib/email';
import { buildEmailHtml, fillTemplate, getVenueEmailTemplate } from '@/lib/email-templates';
import { loadVenueEmailBrand } from '@/lib/venue-email-brand';
import { syncPaymentRemindersForProposal } from '@/lib/payment-reminders';
import { onMarketingProposalPaid } from '@/lib/marketing-email-worker';
import { applySystemTagByEmail, ensureSystemTagsForVenue } from '@/lib/system-tags';
import { formatAmount, notifyOwner } from '@/lib/owner-notifications';
import { dispatchIntegrationEvent } from '@/lib/integration-events';
import { buildBalanceLine, recordOnlinePaymentLedger } from '@/lib/proposal-payments';
import { MIN_PAYMENT_CENTS, addDaysYmd, addMonthsYmd, toYmd } from '@/lib/payment-plan';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');

/** Retry a failed installment this many days after each failed attempt (4 attempts in total). */
const RETRY_AFTER_DAYS = [2, 2, 3];

/**
 * Proposal statuses that stop a payment plan. A partial refund doesn't: it's a
 * credit, and the venue chooses whether to cancel the rest (lib/stripe/refunds.ts).
 */
const PLAN_STOPPED = ['refunded', 'cancelled', 'declined', 'expired'];

/** canceled_reason for a payment that was paid another way (a check, cash, an earlier overpayment). */
const COVERED = 'covered';

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface PaymentProposal {
  id: string;
  venue_id: string;
  status: string;
  price: number;
  customer_name: string | null;
  customer_email: string | null;
  payment_type: string | null;
  payment_config: Record<string, unknown> | null;
  template_id: string | null;
  is_invoice: boolean | null;
  public_token: string;
  collect_manually: boolean | null;
  accept_ach: boolean | null;
  payment_provider: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_processing_at: string | null;
}

const PROPOSAL_COLUMNS =
  'id, venue_id, status, price, customer_name, customer_email, payment_type, payment_config, template_id, is_invoice, ' +
  'public_token, collect_manually, accept_ach, payment_provider, stripe_customer_id, stripe_payment_method_id, ' +
  'stripe_payment_intent_id, payment_processing_at';

interface PaymentVenue extends ConnectVenue {
  brand_color: string | null;
  brand_logo_url: string | null;
}

type Installment = { amount: number; date: string };

export async function loadPaymentProposal(by: { token?: string; id?: string }): Promise<PaymentProposal | null> {
  let q = supabaseAdmin.from('proposals').select(PROPOSAL_COLUMNS);
  q = by.token ? q.eq('public_token', by.token) : q.eq('id', by.id as string);
  const { data } = await q.maybeSingle();
  return (data as unknown as PaymentProposal | null) ?? null;
}

async function loadPaymentVenue(venueId: string): Promise<PaymentVenue | null> {
  const v = await loadConnectVenue(venueId);
  if (!v) return null;
  const { data } = await supabaseAdmin.from('venues').select('brand_color, brand_logo_url').eq('id', venueId).maybeSingle();
  const brand = (data ?? {}) as { brand_color?: string | null; brand_logo_url?: string | null };
  return { ...v, brand_color: brand.brand_color ?? null, brand_logo_url: brand.brand_logo_url ?? null };
}

function installmentsOf(p: Pick<PaymentProposal, 'payment_config'>): Installment[] {
  const list = (p.payment_config as { installments?: Installment[] } | null)?.installments;
  return Array.isArray(list) ? list.filter((i) => Number(i?.amount) > 0) : [];
}

/** What the couple pays now: the whole price, or the first installment. */
export function firstPaymentCents(p: Pick<PaymentProposal, 'payment_type' | 'payment_config' | 'price'>): number {
  if (p.payment_type === 'installment') {
    const first = installmentsOf(p)[0];
    if (first) return Math.round(Number(first.amount));
  }
  return Math.round(Number(p.price));
}

/** What the couple pays now: the first payment, but never more than what's still owed. */
export async function amountDueNowCents(p: Pick<PaymentProposal, 'id' | 'payment_type' | 'payment_config' | 'price'>): Promise<number> {
  const owed = Math.max(Math.round(Number(p.price)) - (await ledgerTotalCents(p.id)), 0);
  return Math.min(firstPaymentCents(p), owed);
}

/** Whether this proposal can take an online payment right now (same rules as the LunarPay flow). */
export function payableNow(p: Pick<PaymentProposal, 'is_invoice' | 'status' | 'collect_manually' | 'payment_type'>): string | null {
  if (p.collect_manually === true) return 'This document is collected directly by the venue.';
  // An invoice is paid as soon as it's opened; a proposal is signed first.
  const allowed = p.is_invoice === true ? ['sent', 'opened', 'signed'] : ['signed'];
  if (!allowed.includes(p.status)) return 'This proposal isn’t ready for payment.';
  const type = p.payment_type || 'full';
  if (type !== 'full' && type !== 'installment') return `Payment type "${type}" isn’t supported online.`;
  return null;
}

/** Card and (when the venue allows it) bank payments. Proposal setting wins over the venue's. */
export function acceptsBank(p: Pick<PaymentProposal, 'accept_ach'>, v: Pick<ConnectVenue, 'accept_ach'>): boolean {
  if (p.accept_ach !== null && p.accept_ach !== undefined) return p.accept_ach !== false;
  return v.accept_ach !== false;
}

// ── Charging the first payment ───────────────────────────────────────────────

/** The couple as a customer on the venue's Stripe account (saved with the proposal). */
async function ensureCoupleCustomer(p: PaymentProposal, account: string): Promise<string> {
  if (p.stripe_customer_id) return p.stripe_customer_id;
  const customer = await getStripe().customers.create(
    {
      email: p.customer_email || undefined,
      name: p.customer_name || undefined,
      metadata: { storyvenue_proposal_id: p.id },
    },
    { stripeAccount: account, idempotencyKey: `sv-couple-${p.id}` },
  );
  await supabaseAdmin.from('proposals').update({ stripe_customer_id: customer.id }).eq('id', p.id);
  p.stripe_customer_id = customer.id;
  return customer.id;
}

export type StartResult =
  | { status: 'succeeded' | 'processing'; paymentIntentId: string }
  | { status: 'requires_action'; paymentIntentId: string; clientSecret: string }
  | { status: 'failed'; error: string };

function kindOfType(type: string | null | undefined): PaymentKind {
  return type === 'us_bank_account' ? 'bank' : 'card';
}

/**
 * Charge the first payment with the couple's details from the payment form (a
 * ConfirmationToken), with StoryVenue's fee for the method they chose.
 */
export async function startProposalPayment(token: string, confirmationTokenId: string): Promise<StartResult> {
  const p = await loadPaymentProposal({ token });
  if (!p) return { status: 'failed', error: 'Proposal not found.' };
  const notPayable = payableNow(p);
  if (notPayable) return { status: 'failed', error: notPayable };
  if (p.payment_processing_at) return { status: 'failed', error: 'A bank payment for this invoice is already processing.' };

  const v = await loadPaymentVenue(p.venue_id);
  if (!v || !venueTakesStripePayments(v) || !v.stripe_account_id) {
    return { status: 'failed', error: 'This venue isn’t set up to take online payments yet.' };
  }
  const account = v.stripe_account_id;
  const stripe = getStripe();

  const ct = await stripe.confirmationTokens.retrieve(confirmationTokenId, {}, { stripeAccount: account });
  const kind = kindOfType(ct.payment_method_preview?.type);
  if (kind === 'bank' && !acceptsBank(p, v)) return { status: 'failed', error: 'Bank payments aren’t accepted for this invoice.' };

  // Never ask for more than what's still owed (the venue may have recorded a check).
  const amount = await amountDueNowCents(p);
  if (amount <= 0) return { status: 'failed', error: 'This invoice is already paid.' };
  const installments = installmentsOf(p);
  const isPlan = p.payment_type === 'installment' && installments.length > 1;
  const customer = await ensureCoupleCustomer(p, account);
  const fee = await applicationFeeCents(v, amount, kind);

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: 'usd',
        customer,
        confirm: true,
        confirmation_token: ct.id,
        // Must match the payment form's list exactly (Stripe rejects a mismatch).
        payment_method_types: acceptsBank(p, v) ? ['card', 'us_bank_account'] : ['card'],
        application_fee_amount: fee,
        // Keep the card or bank account for the automatic installments.
        ...(isPlan ? { setup_future_usage: 'off_session' as const } : {}),
        description: `${v.name ?? 'Venue'} — ${isPlan ? `Payment 1 of ${installments.length}` : 'Payment'}`,
        metadata: {
          storyvenue_proposal_id: p.id,
          storyvenue_venue_id: p.venue_id,
          installment_number: '1',
          payment_kind: kind,
        },
        return_url: `${APP_URL}/proposal/${p.public_token}`,
      },
      { stripeAccount: account, idempotencyKey: `sv-proposal-pay-${p.id}-${ct.id}` },
    );
    return await afterFirstIntent(p.id, pi);
  } catch (e) {
    const msg = (e as { type?: string; message?: string }).type === 'StripeCardError'
      ? (e as Error).message
      : 'Your payment couldn’t be completed. Please try again or use a different payment method.';
    if ((e as { type?: string }).type !== 'StripeCardError') console.error('[stripe-pay] charge failed:', e);
    return { status: 'failed', error: msg };
  }
}

/** Finish after the couple completed extra authentication (3D Secure). */
export async function resumeProposalPayment(token: string, paymentIntentId: string): Promise<StartResult> {
  const p = await loadPaymentProposal({ token });
  if (!p) return { status: 'failed', error: 'Proposal not found.' };
  const v = await loadConnectVenue(p.venue_id);
  if (!v?.stripe_account_id) return { status: 'failed', error: 'This venue isn’t set up to take online payments yet.' };
  const pi = await getStripe().paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: v.stripe_account_id });
  if (pi.metadata?.storyvenue_proposal_id !== p.id) return { status: 'failed', error: 'Payment not found.' };
  return afterFirstIntent(p.id, pi);
}

async function afterFirstIntent(proposalId: string, pi: Stripe.PaymentIntent): Promise<StartResult> {
  if (pi.status === 'requires_action' && pi.client_secret) {
    return { status: 'requires_action', paymentIntentId: pi.id, clientSecret: pi.client_secret };
  }
  if (pi.status === 'succeeded' || pi.status === 'processing') {
    await finalizeFirstPayment(proposalId, pi);
    return { status: pi.status === 'succeeded' ? 'succeeded' : 'processing', paymentIntentId: pi.id };
  }
  return {
    status: 'failed',
    error: pi.last_payment_error?.message || 'Your payment couldn’t be completed. Please try a different payment method.',
  };
}

function paymentMethodId(pi: Stripe.PaymentIntent): string | null {
  return typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id ?? null;
}

function chargeId(pi: Stripe.PaymentIntent): string | null {
  return typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
}

/**
 * Record the first payment. Safe to call more than once (the page, the 3D
 * Secure return and the webhook can all arrive): side effects run only for
 * the call that flips the proposal to paid.
 */
export async function finalizeFirstPayment(proposalId: string, pi: Stripe.PaymentIntent): Promise<void> {
  const common = {
    payment_provider: 'stripe',
    stripe_payment_intent_id: pi.id,
    stripe_payment_method_id: paymentMethodId(pi),
  };

  if (pi.status === 'processing') {
    await supabaseAdmin
      .from('proposals')
      .update({ ...common, payment_processing_at: new Date().toISOString() })
      .eq('id', proposalId)
      .neq('status', 'paid');
    return;
  }
  if (pi.status !== 'succeeded') return;

  const { data: claimed } = await supabaseAdmin
    .from('proposals')
    .update({
      ...common,
      status: 'paid',
      paid_at: new Date().toISOString(),
      payment_processing_at: null,
      transaction_id: chargeId(pi) ?? pi.id,
    })
    .eq('id', proposalId)
    .neq('status', 'paid')
    .select('id');
  if (!claimed?.length) return; // already recorded

  const p = await loadPaymentProposal({ id: proposalId });
  const v = p ? await loadPaymentVenue(p.venue_id) : null;
  if (!p || !v) return;
  const kind: PaymentKind = pi.metadata?.payment_kind === 'bank' ? 'bank' : 'card';

  // Schedule the remaining installments to charge automatically.
  const installments = installmentsOf(p);
  if (p.payment_type === 'installment' && installments.length > 1) {
    const rows = installments.slice(1).map((inst, i) => ({
      proposal_id: p.id,
      venue_id: p.venue_id,
      installment_number: i + 2,
      installment_count: installments.length,
      due_date: String(inst.date).slice(0, 10),
      amount_cents: Math.round(Number(inst.amount)),
      planned_amount_cents: Math.round(Number(inst.amount)),
      status: 'scheduled',
      next_attempt_at: `${String(inst.date).slice(0, 10)}T15:00:00Z`,
    }));
    const { error } = await supabaseAdmin.from('proposal_installments').upsert(rows, { onConflict: 'proposal_id,installment_number', ignoreDuplicates: true });
    if (error) console.error('[stripe-pay] could not schedule installments:', error.message);
  }

  await recordPaymentReceived({
    p,
    v,
    amountCents: pi.amount_received || pi.amount,
    kind,
    reference: pi.id,
    first: true,
  });
  // The scheduled payments add up to what's left, even if part was paid another way.
  await rebalanceScheduledInstallments(p.id);
}

// ── Shared "payment received" side effects ──────────────────────────────────

async function ledgerTotalCents(proposalId: string): Promise<number> {
  const { data } = await supabaseAdmin.from('proposal_payments').select('amount_cents').eq('proposal_id', proposalId);
  return ((data ?? []) as Array<{ amount_cents: number | null }>).reduce((s, r) => s + (Number(r.amount_cents) || 0), 0);
}

async function recordPaymentReceived(args: {
  p: PaymentProposal;
  v: PaymentVenue;
  amountCents: number;
  kind: PaymentKind;
  reference: string;
  first: boolean;
  finalInstallment?: boolean;
}): Promise<void> {
  const { p, v, amountCents, kind, reference, first } = args;
  const paymentType = p.payment_type || 'full';

  await recordOnlinePaymentLedger({
    proposalId: p.id,
    venueId: p.venue_id,
    amountCents,
    method: kind === 'bank' ? 'ach' : 'cc',
    reference,
  });
  const balanceCents = Math.max(Number(p.price) - (await ledgerTotalCents(p.id)), 0);
  const paidInFull = (first && paymentType === 'full') || !!args.finalInstallment || balanceCents <= 0;

  if (first) {
    void syncPaymentRemindersForProposal(p.id);
    void onMarketingProposalPaid(p.venue_id, p.customer_email);
  }

  if (p.customer_email) {
    const email = p.customer_email;
    ensureSystemTagsForVenue(p.venue_id)
      .then(() => {
        // The deposit books the date (the tag's own meaning: "Deposit paid and
        // date officially booked"); the last payment closes the booking.
        if (first) {
          applySystemTagByEmail(p.venue_id, email, 'deposit_paid').catch(() => {});
          applySystemTagByEmail(p.venue_id, email, 'date_confirmed').catch(() => {});
        }
        if (paidInFull) {
          applySystemTagByEmail(p.venue_id, email, 'paid_in_full').catch(() => {});
          applySystemTagByEmail(p.venue_id, email, 'closed_won').catch(() => {});
        }
        if (first && paymentType === 'installment') applySystemTagByEmail(p.venue_id, email, 'payment_plan_active').catch(() => {});
      })
      .catch(() => {});
  }

  const customerName = p.customer_name || 'Customer';
  notifyOwner({
    venueId: p.venue_id,
    scenario: 'payment_received',
    vars: { customer_name: customerName, amount: formatAmount(amountCents) },
    actionUrl: `${APP_URL}/dashboard/transactions`,
  }).catch(() => {});

  void dispatchIntegrationEvent(p.venue_id, 'payment.received', {
    payment: {
      proposal_id: p.id,
      customer_name: customerName,
      customer_email: p.customer_email || '',
      customer_phone: '',
      amount_cents: amountCents,
      amount_dollars: formatAmount(amountCents),
      payment_type: paymentType,
      paid_at: new Date().toISOString(),
    },
  });

  // Receipt with the running balance.
  if (p.customer_email) {
    try {
      const tmpl = await getVenueEmailTemplate(p.venue_id, 'payment_confirmation');
      if (tmpl) {
        const venueName = v.name || 'Your Venue';
        const usd =(c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
        const vars = {
          organization: venueName,
          customer_name: customerName,
          amount: usd(amountCents),
          date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          payment_method: kind === 'bank' ? 'bank transfer' : 'card',
          balance_due: usd(balanceCents),
          balance_line: buildBalanceLine(balanceCents),
        };
        await directSendEmail({
          to: p.customer_email,
          subject: fillTemplate(tmpl.subject, vars),
          html: buildEmailHtml({
            template: tmpl,
            vars,
            actionUrl: `${APP_URL}/invoice/${p.id}`,
            brandColor: v.brand_color || '#1b1b1b',
            venueBrand: await loadVenueEmailBrand(p.venue_id),
            venueName,
          }),
        });
      }
    } catch (e) {
      console.error('[stripe-pay] receipt email failed:', e);
    }
  }
}

/** Tell the couple (and the venue) a payment didn't go through. */
async function notifyPaymentFailed(args: {
  p: PaymentProposal;
  v: Pick<ConnectVenue, 'name'>;
  amountCents: number;
  reason: string;
  actionUrl: string;
  notifyVenue: boolean;
}): Promise<void> {
  const { p, v, amountCents, reason, actionUrl } = args;
  if (args.notifyVenue) {
    await notifyOwner({
      venueId: p.venue_id,
      scenario: 'payment_failed',
      vars: { customer_name: p.customer_name || 'Customer', amount: formatAmount(amountCents), reason },
      actionUrl: `${APP_URL}/dashboard/transactions`,
    }).catch(() => {});
    if (p.customer_email) {
      ensureSystemTagsForVenue(p.venue_id)
        .then(() => applySystemTagByEmail(p.venue_id, p.customer_email as string, 'payment_failed'))
        .catch(() => {});
    }
  }
  if (!p.customer_email) return;
  try {
    const tmpl = await getVenueEmailTemplate(p.venue_id, 'payment_failed');
    if (!tmpl) return;
    const vars: Record<string, string> = {
      organization: v.name || 'Your Venue',
      customer_name: p.customer_name || 'there',
      amount: formatAmount(amountCents),
      reason,
    };
    await directSendEmail({
      to: p.customer_email,
      subject: fillTemplate(tmpl.subject, vars),
      html: buildEmailHtml({ template: tmpl, vars, actionUrl, venueName: v.name || 'Your Venue', venueBrand: await loadVenueEmailBrand(p.venue_id) }),
    });
  } catch (e) {
    console.error('[stripe-pay] payment_failed email failed:', e);
  }
}

/** A first payment by bank that bounced after it was submitted. */
export async function onFirstPaymentFailed(proposalId: string, pi: Stripe.PaymentIntent): Promise<void> {
  const { data: cleared } = await supabaseAdmin
    .from('proposals')
    .update({ payment_processing_at: null })
    .eq('id', proposalId)
    .eq('stripe_payment_intent_id', pi.id)
    .neq('status', 'paid')
    .select('id');
  if (!cleared?.length) return;
  const p = await loadPaymentProposal({ id: proposalId });
  const v = p ? await loadConnectVenue(p.venue_id) : null;
  if (!p || !v) return;
  await notifyPaymentFailed({
    p,
    v,
    amountCents: pi.amount,
    reason: pi.last_payment_error?.message || 'The bank payment didn’t go through',
    actionUrl: `${APP_URL}/proposal/${p.public_token}`,
    notifyVenue: true,
  });
}

// ── Automatic installments ───────────────────────────────────────────────────

interface InstallmentRow {
  id: string;
  proposal_id: string;
  venue_id: string;
  installment_number: number;
  installment_count: number;
  amount_cents: number;
  attempts: number;
  payment_intent_id: string | null;
}

const INSTALLMENT_COLUMNS = 'id, proposal_id, venue_id, installment_number, installment_count, amount_cents, attempts, payment_intent_id';

/**
 * What the couple still owes: the price, less everything in the payment
 * ledger and any automatic payment already on its way (a bank payment that
 * hasn't settled, or one another run is charging right now).
 */
async function stillOwedCents(p: Pick<PaymentProposal, 'id' | 'price'>, exceptInstallmentId?: string): Promise<number> {
  const [paid, { data }] = await Promise.all([
    ledgerTotalCents(p.id),
    supabaseAdmin.from('proposal_installments').select('id, amount_cents').eq('proposal_id', p.id).eq('status', 'processing'),
  ]);
  const inFlight = ((data ?? []) as Array<{ id: string; amount_cents: number }>)
    .filter((r) => r.id !== exceptInstallmentId)
    .reduce((s, r) => s + (Number(r.amount_cents) || 0), 0);
  return Math.max(Math.round(Number(p.price)) - paid - inFlight, 0);
}

/**
 * Keep the payments still to come in line with what's owed. After a payment
 * made another way (a check or cash the venue recorded), the next payments
 * are trimmed first and any no longer needed are canceled; if that payment is
 * removed again, they go back toward their original amounts. An automatic
 * payment never goes above what the couple agreed to.
 */
export async function rebalanceScheduledInstallments(proposalId: string): Promise<void> {
  const [{ data: prop }, { data: rowData }] = await Promise.all([
    supabaseAdmin.from('proposals').select('id, price, status').eq('id', proposalId).maybeSingle(),
    supabaseAdmin
      .from('proposal_installments')
      .select('id, amount_cents, planned_amount_cents, status, canceled_reason, due_date')
      .eq('proposal_id', proposalId)
      .order('installment_number', { ascending: true }),
  ]);
  const p = prop as { id: string; price: number; status: string } | null;
  const rows = (rowData ?? []) as Array<{
    id: string;
    amount_cents: number;
    planned_amount_cents: number | null;
    status: string;
    canceled_reason: string | null;
    due_date: string;
  }>;
  if (!p || !rows.length || PLAN_STOPPED.includes(p.status)) return;

  let left = await stillOwedCents(p);
  const open = rows.filter(
    (r) => r.status === 'scheduled' || r.status === 'failed' || (r.status === 'canceled' && r.canceled_reason === COVERED),
  );
  const now = new Date().toISOString();

  // What's owed goes to the latest payments first, so a check covers the next payment.
  for (const r of [...open].reverse()) {
    const planned = Number(r.planned_amount_cents ?? r.amount_cents);
    const amount = Math.min(planned, left);
    if (amount >= MIN_PAYMENT_CENTS) {
      left -= amount;
      if (r.status === 'canceled') {
        const dueAt = `${String(r.due_date).slice(0, 10)}T15:00:00Z`;
        await supabaseAdmin
          .from('proposal_installments')
          .update({
            status: 'scheduled',
            amount_cents: amount,
            canceled_reason: null,
            attempts: 0,
            last_error: null,
            next_attempt_at: dueAt > now ? dueAt : now,
            updated_at: now,
          })
          .eq('id', r.id)
          .eq('status', 'canceled');
      } else if (amount !== r.amount_cents) {
        await supabaseAdmin
          .from('proposal_installments')
          .update({ amount_cents: amount, updated_at: now })
          .eq('id', r.id)
          .in('status', ['scheduled', 'failed']);
      }
    } else if (r.status !== 'canceled') {
      await supabaseAdmin
        .from('proposal_installments')
        .update({ status: 'canceled', canceled_reason: COVERED, updated_at: now })
        .eq('id', r.id)
        .in('status', ['scheduled', 'failed']);
    }
  }
}

/** A link for the couple to update the card used for their installments. */
async function cardUpdateLink(p: PaymentProposal): Promise<string> {
  const token = randomBytes(24).toString('hex');
  const { error } = await supabaseAdmin.from('card_update_tokens').insert({
    venue_id: p.venue_id,
    proposal_id: p.id,
    customer_email: p.customer_email,
    token,
    used: false,
  });
  return error ? `${APP_URL}/invoice/${p.id}` : `${APP_URL}/update-card/${token}`;
}

export async function markInstallmentPaid(row: InstallmentRow, pi: Stripe.PaymentIntent): Promise<void> {
  const { data: claimed } = await supabaseAdmin
    .from('proposal_installments')
    .update({ status: 'paid', paid_at: new Date().toISOString(), payment_intent_id: pi.id, last_error: null, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .neq('status', 'paid')
    .select('id');
  if (!claimed?.length) return;
  const p = await loadPaymentProposal({ id: row.proposal_id });
  const v = p ? await loadPaymentVenue(p.venue_id) : null;
  if (!p || !v) return;
  await recordPaymentReceived({
    p,
    v,
    amountCents: pi.amount_received || pi.amount,
    kind: pi.metadata?.payment_kind === 'bank' ? 'bank' : 'card',
    reference: pi.id,
    first: false,
    finalInstallment: row.installment_number >= row.installment_count,
  });
  // Paid in full early: the payments still waiting are no longer needed.
  await rebalanceScheduledInstallments(row.proposal_id);
}

export async function markInstallmentFailed(row: InstallmentRow, reason: string, paymentIntentId: string | null): Promise<void> {
  const attempts = row.attempts + 1;
  const retryIn = RETRY_AFTER_DAYS[attempts - 1];
  const finalFailure = retryIn === undefined;
  await supabaseAdmin
    .from('proposal_installments')
    .update({
      status: finalFailure ? 'failed' : 'scheduled',
      attempts,
      last_error: reason.slice(0, 500),
      payment_intent_id: paymentIntentId ?? row.payment_intent_id,
      next_attempt_at: finalFailure ? null : new Date(Date.now() + retryIn * 86_400_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  // Email the couple on the first and the last failure; the venue on both.
  if (attempts !== 1 && !finalFailure) return;
  const p = await loadPaymentProposal({ id: row.proposal_id });
  const v = p ? await loadConnectVenue(p.venue_id) : null;
  if (!p || !v) return;
  await notifyPaymentFailed({
    p,
    v,
    amountCents: row.amount_cents,
    reason: finalFailure ? `${reason} (no more automatic retries)` : reason,
    actionUrl: await cardUpdateLink(p),
    notifyVenue: true,
  });
}

export type ChargeOutcome =
  | { result: 'charged' }
  | { result: 'processing' }
  | { result: 'failed'; reason: string }
  | { result: 'skipped'; reason: string };

/**
 * Charge one scheduled payment now: bring the plan in line with what's still
 * owed, claim the payment so overlapping runs can't charge it twice, and never
 * charge more than the balance.
 */
async function chargeInstallment(due: { id: string; proposal_id: string }): Promise<ChargeOutcome> {
  await rebalanceScheduledInstallments(due.proposal_id);
  const claimedAt = new Date().toISOString();
  const { data: claimed } = await supabaseAdmin
    .from('proposal_installments')
    .update({ status: 'processing', updated_at: claimedAt })
    .eq('id', due.id)
    .eq('status', 'scheduled')
    .select(INSTALLMENT_COLUMNS);
  const row = ((claimed ?? []) as unknown as InstallmentRow[])[0];
  if (!row) return { result: 'skipped', reason: 'This payment isn’t waiting to be charged.' };

  const p = await loadPaymentProposal({ id: row.proposal_id });
  const v = p ? await loadConnectVenue(p.venue_id) : null;
  if (!p || PLAN_STOPPED.includes(p.status)) {
    await supabaseAdmin.from('proposal_installments').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', row.id);
    return { result: 'skipped', reason: 'The proposal was refunded or canceled.' };
  }

  // Never charge more than what's still owed.
  const owed = await stillOwedCents(p, row.id);
  if (owed < MIN_PAYMENT_CENTS) {
    await supabaseAdmin
      .from('proposal_installments')
      .update({ status: 'canceled', canceled_reason: COVERED, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    return { result: 'skipped', reason: 'Nothing is owed. The balance is already paid.' };
  }
  if (owed < row.amount_cents) {
    await supabaseAdmin.from('proposal_installments').update({ amount_cents: owed }).eq('id', row.id);
    row.amount_cents = owed;
  }
  if (!v || !venueTakesStripePayments(v) || !v.stripe_account_id || !p.stripe_customer_id || !p.stripe_payment_method_id) {
    await supabaseAdmin
      .from('proposal_installments')
      .update({ status: 'scheduled', last_error: 'Online payments are not active for this venue.', next_attempt_at: new Date(Date.now() + 86_400_000).toISOString(), updated_at: new Date().toISOString() })
      .eq('id', row.id);
    return { result: 'skipped', reason: 'Online payments are not active for this venue.' };
  }

  const stripe = getStripe();
  const account = v.stripe_account_id;
  try {
    const pm = await stripe.paymentMethods.retrieve(p.stripe_payment_method_id, {}, { stripeAccount: account });
    const kind = kindOfType(pm.type);
    const pi = await stripe.paymentIntents.create(
      {
        amount: row.amount_cents,
        currency: 'usd',
        customer: p.stripe_customer_id,
        payment_method: pm.id,
        off_session: true,
        confirm: true,
        application_fee_amount: await applicationFeeCents(v, row.amount_cents, kind),
        description: `${v.name ?? 'Venue'} — Payment ${row.installment_number} of ${row.installment_count}`,
        metadata: {
          storyvenue_proposal_id: p.id,
          storyvenue_venue_id: p.venue_id,
          storyvenue_installment_id: row.id,
          installment_number: String(row.installment_number),
          payment_kind: kind,
        },
      },
      // One key per claim: Stripe's own network retries reuse it, and a new
      // attempt (a retry, a new card, "charge now") never replays an old one.
      { stripeAccount: account, idempotencyKey: `sv-installment-${row.id}-${row.attempts + 1}-${Date.parse(claimedAt)}` },
    );
    if (pi.status === 'succeeded') {
      await markInstallmentPaid(row, pi);
      return { result: 'charged' };
    }
    if (pi.status === 'processing') {
      await supabaseAdmin.from('proposal_installments').update({ payment_intent_id: pi.id, updated_at: new Date().toISOString() }).eq('id', row.id);
      return { result: 'processing' };
    }
    const reason = pi.last_payment_error?.message || 'The payment was declined';
    await markInstallmentFailed(row, reason, pi.id);
    return { result: 'failed', reason };
  } catch (e) {
    const err = e as { message?: string; raw?: { payment_intent?: { id?: string } } };
    const reason = err.message || 'The payment was declined';
    await markInstallmentFailed(row, reason, err.raw?.payment_intent?.id ?? null);
    return { result: 'failed', reason };
  }
}

/** Charge every installment that's due (hourly cron). */
export async function chargeDueInstallments(limit = 50): Promise<{ charged: number; processing: number; failed: number; skipped: number }> {
  const out = { charged: 0, processing: 0, failed: 0, skipped: 0 };
  const { data } = await supabaseAdmin
    .from('proposal_installments')
    .select('id, proposal_id')
    .eq('status', 'scheduled')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit);
  for (const due of (data ?? []) as Array<{ id: string; proposal_id: string }>) {
    out[(await chargeInstallment(due)).result]++;
  }
  return out;
}

/** Webhook: a bank installment settled or bounced after it was submitted. */
export async function onInstallmentIntentUpdate(pi: Stripe.PaymentIntent): Promise<void> {
  const id = pi.metadata?.storyvenue_installment_id;
  if (!id) return;
  const { data } = await supabaseAdmin
    .from('proposal_installments')
    .select('id, proposal_id, venue_id, installment_number, installment_count, amount_cents, attempts, payment_intent_id, status')
    .eq('id', id)
    .maybeSingle();
  const row = data as (InstallmentRow & { status: string }) | null;
  if (!row || row.status === 'paid') return;
  if (pi.status === 'succeeded') await markInstallmentPaid(row, pi);
  else if (
    (pi.status === 'requires_payment_method' || pi.status === 'canceled')
    // Only a payment still in flight (a bank payment): a card that declined was
    // already counted when it was charged, and counting it again here used to
    // end the plan's retries after two tries instead of four.
    && row.status === 'processing' && row.payment_intent_id === pi.id
  ) {
    await markInstallmentFailed(row, pi.last_payment_error?.message || 'The bank payment didn’t go through', pi.id);
  }
}

// ── Heads-up before each automatic payment ───────────────────────────────────

function longDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "Visa ending in 4242" / "bank account ending in 6789" for the saved payment method. */
export async function paymentMethodLabel(p: Pick<PaymentProposal, 'stripe_payment_method_id'>, account: string): Promise<string> {
  if (!p.stripe_payment_method_id) return 'the card on file';
  try {
    const pm = await getStripe().paymentMethods.retrieve(p.stripe_payment_method_id, {}, { stripeAccount: account });
    if (pm.card) {
      const brand = pm.card.brand ? pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1) : 'Card';
      return `${brand === 'Amex' ? 'American Express' : brand} ending in ${pm.card.last4}`;
    }
    if (pm.us_bank_account) return `${pm.us_bank_account.bank_name || 'Bank account'} ending in ${pm.us_bank_account.last4}`;
  } catch {
    /* fall through */
  }
  return 'the card on file';
}

/**
 * Email the couple 3 days before each automatic payment (hourly cron), with
 * the amount, date, card and a link to update it. Each payment gets one
 * heads-up; changing its date sends a new one.
 */
export async function sendUpcomingPaymentHeadsUps(limit = 50): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from('proposal_installments')
    .select('id, proposal_id, amount_cents, due_date')
    .eq('status', 'scheduled')
    .eq('attempts', 0)
    .is('heads_up_sent_at', null)
    .gt('due_date', today)
    .lte('due_date', addDaysYmd(today, 3))
    .order('due_date', { ascending: true })
    .limit(limit);

  for (const row of (data ?? []) as Array<{ id: string; proposal_id: string; amount_cents: number; due_date: string }>) {
    const { data: claimed } = await supabaseAdmin
      .from('proposal_installments')
      .update({ heads_up_sent_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('heads_up_sent_at', null)
      .select('id');
    if (!claimed?.length) continue;

    const p = await loadPaymentProposal({ id: row.proposal_id });
    const v = p ? await loadPaymentVenue(p.venue_id) : null;
    if (!p?.customer_email || PLAN_STOPPED.includes(p.status) || !v || !venueTakesStripePayments(v) || !v.stripe_account_id) {
      out.skipped++;
      continue;
    }
    const amount = Math.min(row.amount_cents, await stillOwedCents(p, row.id));
    if (amount < MIN_PAYMENT_CENTS) { out.skipped++; continue; }
    const tmpl = await getVenueEmailTemplate(p.venue_id, 'payment_upcoming');
    if (!tmpl) { out.skipped++; continue; } // the venue turned this email off

    try {
      const venueName = v.name || 'Your Venue';
      const vars: Record<string, string> = {
        organization: venueName,
        customer_name: p.customer_name || 'there',
        amount: formatAmount(amount),
        due_date: longDate(String(row.due_date).slice(0, 10)),
        payment_method: await paymentMethodLabel(p, v.stripe_account_id),
      };
      const { data: brand } = await supabaseAdmin.from('venues').select('brand_email, email').eq('id', p.venue_id).maybeSingle();
      const replyTo = (brand as { brand_email?: string | null; email?: string | null } | null)?.brand_email
        || (brand as { email?: string | null } | null)?.email
        || undefined;
      const r = await directSendEmail({
        to: p.customer_email,
        subject: fillTemplate(tmpl.subject, vars),
        html: buildEmailHtml({
          template: tmpl,
          vars,
          actionUrl: await cardUpdateLink(p),
          brandColor: v.brand_color || '#1b1b1b',
          venueBrand: await loadVenueEmailBrand(p.venue_id),
          venueName,
        }),
        replyTo,
        from: { name: venueName },
      });
      if (r.success) out.sent++;
      else out.skipped++;
    } catch (e) {
      console.error('[stripe-pay] heads-up email failed:', e);
      out.skipped++;
    }
  }
  return out;
}

// ── The venue managing a payment plan ───────────────────────────────────────

export type PlanAction =
  | { action: 'reschedule'; installmentId: string; date: string }
  | { action: 'push_all'; months?: number }
  | { action: 'charge_now'; installmentId: string }
  | { action: 'cancel_remaining' }
  | { action: 'send_card_link' };

export type PlanActionResult = { ok: true; message: string } | { ok: false; error: string };

const OPEN_STATUSES = ['scheduled', 'failed'];

/** Tell the couple where to update the card for their payment plan. */
async function emailCardUpdateLink(p: PaymentProposal, v: PaymentVenue): Promise<boolean> {
  if (!p.customer_email) return false;
  const venueName = v.name || 'Your Venue';
  const vars: Record<string, string> = { organization: venueName, customer_name: p.customer_name || 'there' };
  const template = {
    type: 'card_update_link',
    subject: 'Update your payment method — {{organization}}',
    heading: 'Update your payment method',
    body: 'Hi {{customer_name}},\n\n{{organization}} sent you this link to update the card or bank account used for your payment plan. It only takes a minute, and your next payments will use the new one.',
    button_text: 'Update payment method',
    footer: null,
    enabled: true,
  };
  const r = await directSendEmail({
    to: p.customer_email,
    subject: fillTemplate(template.subject, vars),
    html: buildEmailHtml({
      template,
      vars,
      actionUrl: await cardUpdateLink(p),
      brandColor: v.brand_color || '#1b1b1b',
      venueBrand: await loadVenueEmailBrand(p.venue_id),
      venueName,
    }),
    from: { name: venueName },
  });
  return r.success;
}

/**
 * The venue's plan tools: move a payment's date, move every remaining payment
 * a month later, charge a payment now, cancel the rest, or send the couple a
 * card-update link. Only for plans charged automatically on the venue's Stripe.
 */
export async function managePaymentPlan(venueId: string, proposalId: string, a: PlanAction): Promise<PlanActionResult> {
  const p = await loadPaymentProposal({ id: proposalId });
  if (!p || p.venue_id !== venueId) return { ok: false, error: 'Payment plan not found.' };
  if (p.payment_type !== 'installment' || p.payment_provider !== 'stripe') {
    return { ok: false, error: 'This isn’t an automatic payment plan.' };
  }
  if (PLAN_STOPPED.includes(p.status)) return { ok: false, error: 'This plan was refunded or canceled.' };
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  if (a.action === 'send_card_link') {
    const v = await loadPaymentVenue(p.venue_id);
    if (!v || !(await emailCardUpdateLink(p, v))) return { ok: false, error: 'The email couldn’t be sent.' };
    return { ok: true, message: `Sent a card update link to ${p.customer_email}.` };
  }

  if (a.action === 'cancel_remaining') {
    const { data } = await supabaseAdmin
      .from('proposal_installments')
      .update({ status: 'canceled', canceled_reason: 'plan_canceled', updated_at: now })
      .eq('proposal_id', p.id)
      .in('status', OPEN_STATUSES)
      .select('id');
    const n = data?.length ?? 0;
    return { ok: true, message: n ? `Canceled ${n} remaining payment${n === 1 ? '' : 's'}. Nothing more will be charged automatically.` : 'No payments were waiting.' };
  }

  if (a.action === 'push_all') {
    const months = Math.max(1, Math.min(Math.round(Number(a.months) || 1), 12));
    const { data } = await supabaseAdmin
      .from('proposal_installments')
      .select('id, due_date')
      .eq('proposal_id', p.id)
      .in('status', OPEN_STATUSES);
    const rows = (data ?? []) as Array<{ id: string; due_date: string }>;
    const tomorrow = addDaysYmd(today, 1);
    for (const r of rows) {
      const moved = addMonthsYmd(String(r.due_date).slice(0, 10), months);
      const date = moved < tomorrow ? tomorrow : moved;
      await supabaseAdmin
        .from('proposal_installments')
        .update({ due_date: date, next_attempt_at: `${date}T15:00:00Z`, status: 'scheduled', last_error: null, heads_up_sent_at: null, updated_at: now })
        .eq('id', r.id)
        .in('status', OPEN_STATUSES);
    }
    return { ok: true, message: rows.length ? `Moved ${rows.length} payment${rows.length === 1 ? '' : 's'} ${months} month${months === 1 ? '' : 's'} later.` : 'No payments were waiting.' };
  }

  // Actions on one payment.
  const { data: rowData } = await supabaseAdmin
    .from('proposal_installments')
    .select('id, proposal_id, status')
    .eq('id', a.installmentId)
    .eq('proposal_id', p.id)
    .maybeSingle();
  const row = rowData as { id: string; proposal_id: string; status: string } | null;
  if (!row) return { ok: false, error: 'Payment not found.' };
  if (!OPEN_STATUSES.includes(row.status)) return { ok: false, error: 'Only a payment that’s waiting or failed can be changed.' };

  if (a.action === 'reschedule') {
    const date = toYmd(a.date);
    if (!date || date <= today) return { ok: false, error: 'Pick a date after today.' };
    await supabaseAdmin
      .from('proposal_installments')
      .update({ due_date: date, next_attempt_at: `${date}T15:00:00Z`, status: 'scheduled', last_error: null, heads_up_sent_at: null, updated_at: now })
      .eq('id', row.id)
      .in('status', OPEN_STATUSES);
    return { ok: true, message: `Moved to ${longDate(date)}.` };
  }

  // charge_now
  await supabaseAdmin
    .from('proposal_installments')
    .update({ status: 'scheduled', next_attempt_at: now, updated_at: now })
    .eq('id', row.id)
    .in('status', OPEN_STATUSES);
  const outcome = await chargeInstallment({ id: row.id, proposal_id: p.id });
  if (outcome.result === 'charged' || outcome.result === 'processing') {
    return {
      ok: true,
      message: outcome.result === 'charged' ? 'Charged. A receipt was emailed to your client.' : 'Bank payment submitted. It takes 3–5 business days to clear.',
    };
  }
  return { ok: false, error: outcome.reason };
}
