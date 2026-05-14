import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  createCustomer,
  listCustomers,
  savePaymentMethod,
  savePaymentMethodFromVault,
  createCharge,
  createPaymentSchedule,
  createSubscription,
} from '@/lib/lunarpay';

import { sendEmail as directSendEmail } from '@/lib/email';
import { getVenueEmailTemplate, buildEmailHtml, fillTemplate } from '@/lib/email-templates';
import { syncPaymentRemindersForProposal } from '@/lib/payment-reminders';
import { onMarketingProposalPaid } from '@/lib/marketing-email-worker';
import { applySystemTagByEmail, ensureSystemTagsForVenue } from '@/lib/system-tags';
import { notifyOwner, formatAmount, HIGH_VALUE_THRESHOLD_CENTS } from '@/lib/owner-notifications';
import { dispatchIntegrationEvent } from '@/lib/integration-events';

/**
 * Extract the `id` from a LunarPay API response, tolerating
 * `{ id }`, `{ data: { id } }`, and `{ data: { payment_method: { id } } }`.
 */
function extractId(raw: unknown): number {
  const r    = (raw ?? {}) as Record<string, unknown>;
  const root = (r.data ?? r) as Record<string, unknown>;
  const pm   = (root.payment_method ?? root) as Record<string, unknown>;
  const id   = pm.id ?? root.id ?? r.id;
  return Number(id);
}

function applyFee(cents: number, ratePercent: number): number {
  if (ratePercent <= 0) return cents;
  return Math.round(cents * (1 + ratePercent / 100));
}

function nextBillingDate(frequency: string): string {
  const d = new Date();
  if (frequency === 'weekly')      d.setDate(d.getDate() + 7);
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else                             d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

interface InstallmentConfig { installments: Array<{ amount: number; date: string }>; }
interface SubscriptionConfig { amount: number; frequency: string; start_date: string; }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  let body: { ticketId?: string; vaultId?: string; paymentMethod?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { ticketId, vaultId, paymentMethod = 'cc' } = body;
  if (!ticketId && !vaultId) {
    return NextResponse.json({ error: 'ticketId or vaultId required' }, { status: 400 });
  }

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, venue_id, status, price, customer_name, customer_email, customer_lunarpay_id, payment_type, payment_config, template_id, public_token')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  // Invoices have no template_id (same logic as the public proposals GET route)
  const isInvoice = !proposal.template_id;
  const allowedStatuses = isInvoice ? ['sent', 'opened', 'signed'] : ['signed'];
  if (!allowedStatuses.includes(proposal.status as string)) {
    if (proposal.status === 'paid') return NextResponse.json({ success: true, already_paid: true });
    return NextResponse.json({ error: 'Proposal not ready for payment' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, lunarpay_secret_key, service_fee_rate, brand_color, brand_logo_url')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  const feeRate = Number((venue as Record<string, unknown>).service_fee_rate ?? 0);
  const addFee = feeRate > 0;
  const sk = venue.lunarpay_secret_key as string;

  try {
    // ── Find or create LP customer ─────────────────────────────────────────
    let customerId: number = proposal.customer_lunarpay_id ? Number(proposal.customer_lunarpay_id) : 0;

    if (!customerId && proposal.customer_email) {
      try {
        const res = await listCustomers(sk, proposal.customer_email as string);
        const list: Record<string, unknown>[] = Array.isArray(res) ? res : ((res as Record<string, unknown>).data as Record<string, unknown>[] ?? []);
        const match = list.find((c) => c.email === proposal.customer_email);
        if (match?.id) customerId = Number(match.id);
      } catch { /* create below */ }
    }

    if (!customerId) {
      const parts = ((proposal.customer_name as string) || '').trim().split(' ');
      const cr = await createCustomer(sk, {
        firstName: parts[0] || '',
        lastName:  parts.slice(1).join(' ') || '',
        email:     proposal.customer_email || '',
      });
      customerId = extractId(cr);
      await supabaseAdmin.from('proposals').update({ customer_lunarpay_id: customerId }).eq('id', proposal.id);
    }
    if (!customerId || Number.isNaN(customerId)) {
      throw new Error('Could not resolve LunarPay customer id.');
    }

    // ── Determine amounts and trial status ─────────────────────────────────
    const paymentType = (proposal.payment_type as string) || 'full';
    const config = proposal.payment_config as Record<string, unknown> | null;

    const isTrial = paymentType === 'subscription' && (() => {
      const sd = (config as SubscriptionConfig | null)?.start_date;
      return Boolean(sd && new Date(sd) > new Date());
    })();

    let firstChargeCents = proposal.price as number;
    if (paymentType === 'installment') {
      const ic = config as InstallmentConfig | null;
      firstChargeCents = ic?.installments?.[0]?.amount ?? (proposal.price as number);
    } else if (paymentType === 'subscription') {
      const sc = config as SubscriptionConfig | null;
      firstChargeCents = sc?.amount ?? (proposal.price as number);
    }
    const finalChargeCents = isTrial ? 0 : (addFee ? applyFee(firstChargeCents, feeRate) : firstChargeCents);

    const updateData: Record<string, unknown> = {
      status:               'paid',
      paid_at:              new Date().toISOString(),
      customer_lunarpay_id: customerId,
    };

    // ── Save the card / get paymentMethodId ─────────────────────────────────
    // Per LP docs (May 2026): the ticket from ticket_success can ONLY be used
    // to save the card via POST /customers/:id/payment-methods. Real charges
    // always go through POST /charges with the resulting paymentMethodId.
    // For pay-in-full we keep setDefault:false so the card isn't promoted to
    // primary; for installment/subscription it must be default for LP's cron
    // to charge it on future due dates.
    let paymentMethodId: number;
    if (vaultId) {
      // Trial: tokenize_success path (savePaymentMethod:true intention, no charge)
      const pmRes = await savePaymentMethodFromVault(sk, customerId, vaultId, paymentMethod);
      paymentMethodId = extractId(pmRes);
    } else {
      const pmRes = await savePaymentMethod(
        sk,
        customerId,
        ticketId!,
        (proposal.customer_name as string) || '',
        {
          paymentMethod,
          setDefault: paymentType !== 'full',
        },
      );
      paymentMethodId = extractId(pmRes);
    }
    console.log('[pay] paymentMethodId resolved to:', paymentMethodId);
    if (!paymentMethodId || Number.isNaN(paymentMethodId)) {
      throw new Error('Could not save payment method (no id returned from LunarPay).');
    }
    updateData.payment_method_id = paymentMethodId;

    // ── Charge first payment (everything except trials) ─────────────────────
    if (!isTrial && finalChargeCents > 0) {
      const desc =
        paymentType === 'installment'
          ? `${venue.name} - Payment 1 of ${(config as InstallmentConfig | null)?.installments?.length || 1}`
          : paymentType === 'subscription'
          ? `${venue.name} - First ${(config as SubscriptionConfig | null)?.frequency || 'monthly'} payment`
          : `${venue.name} - Proposal Payment`;

      console.log('[pay] charging', { customerId, paymentMethodId, amount: finalChargeCents });
      const chargeRes = await createCharge(sk, {
        customerId,
        paymentMethodId,
        amount:      finalChargeCents,
        description: desc,
      });
      const chargeId = extractId(chargeRes);
      console.log('[pay] charge created:', chargeId);
      updateData.charge_id      = chargeId;
      updateData.transaction_id = chargeId;
    }

    // ── Create recurring resource ──────────────────────────────────────────
    if (paymentType === 'installment') {
      const ic = config as InstallmentConfig | null;
      const remaining = (ic?.installments ?? []).slice(1);
      if (remaining.length > 0) {
        const sr = await createPaymentSchedule(sk, {
          customerId,
          paymentMethodId,
          description: `${proposal.customer_name} - Installment plan`,
          payments: remaining.map((p) => ({
            amount: addFee ? applyFee(p.amount, feeRate) : p.amount,
            date:   p.date,
          })),
        });
        updateData.payment_schedule_id = extractId(sr);
      }
    } else if (paymentType === 'subscription') {
      const sc = config as SubscriptionConfig | null;
      const startOnIso = isTrial
        ? (sc?.start_date?.length === 10 ? `${sc.start_date}T12:00:00.000Z` : sc?.start_date ?? new Date().toISOString())
        : nextBillingDate(sc?.frequency ?? 'monthly');

      const subr = await createSubscription(sk, {
        customerId,
        paymentMethodId,
        amount:     addFee ? applyFee(sc?.amount ?? 0, feeRate) : (sc?.amount ?? 0),
        frequency:  sc?.frequency ?? 'monthly',
        startOn:    startOnIso,
        description: `${proposal.customer_name} - ${sc?.frequency ?? 'monthly'} subscription`,
      });
      updateData.subscription_id = extractId(subr);
    }

    await supabaseAdmin.from('proposals').update(updateData).eq('id', proposal.id);

    // ── Side effects ───────────────────────────────────────────────────────
    void syncPaymentRemindersForProposal(proposal.id);
    void onMarketingProposalPaid(proposal.venue_id as string, proposal.customer_email as string | null);

    if (proposal.venue_id && proposal.customer_email) {
      const vId = proposal.venue_id as string;
      const cEmail = proposal.customer_email as string;
      ensureSystemTagsForVenue(vId).then(() => {
        applySystemTagByEmail(vId, cEmail, 'deposit_paid').catch(() => {});
        if (paymentType === 'full') {
          applySystemTagByEmail(vId, cEmail, 'paid_in_full').catch(() => {});
          applySystemTagByEmail(vId, cEmail, 'closed_won').catch(() => {});
          applySystemTagByEmail(vId, cEmail, 'date_confirmed').catch(() => {});
        }
        if (paymentType === 'subscription' || paymentType === 'installment') {
          applySystemTagByEmail(vId, cEmail, 'payment_plan_active').catch(() => {});
        }
      }).catch(() => {});
    }

    const customerName = (proposal.customer_name as string) || 'Customer';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
    const dashUrl = `${appUrl}/dashboard/transactions`;

    if (paymentType === 'subscription') {
      const sc = config as SubscriptionConfig | null;
      notifyOwner({ venueId: proposal.venue_id as string, scenario: 'subscription_created',
        vars: { customer_name: customerName, amount: formatAmount(sc?.amount ?? 0), frequency: sc?.frequency ?? '' },
        actionUrl: dashUrl }).catch(() => {});
    }

    if (!isTrial) {
      notifyOwner({ venueId: proposal.venue_id as string, scenario: 'payment_received',
        vars: { customer_name: customerName, amount: formatAmount(finalChargeCents) },
        actionUrl: dashUrl, alsoHighValue: finalChargeCents >= HIGH_VALUE_THRESHOLD_CENTS }).catch(() => {});

      if (proposal.venue_id) {
        void dispatchIntegrationEvent(proposal.venue_id as string, 'payment.received', {
          payment: {
            proposal_id: proposal.id,
            customer_name: customerName,
            customer_email: proposal.customer_email || '',
            customer_phone: '',
            amount_cents: finalChargeCents,
            amount_dollars: formatAmount(finalChargeCents),
            payment_type: paymentType,
            paid_at: new Date().toISOString(),
          },
        });
      }
    }

    // Customer receipt email
    try {
      if (proposal.customer_email && venue?.id) {
        const brandColor = ((venue as Record<string, unknown>).brand_color as string) || '#1b1b1b';
        const logoUrl   = ((venue as Record<string, unknown>).brand_logo_url as string | null) ?? undefined;
        const invoiceUrl = `${appUrl}/proposal/${proposal.public_token}`;
        const venueName  = (venue.name as string) || 'Your Venue';
        const sc = config as SubscriptionConfig | null;

        if (paymentType === 'subscription') {
          const tmpl = await getVenueEmailTemplate(venue.id as string, 'subscription_confirmation');
          if (tmpl) {
            const subAmtFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((sc?.amount ?? 0) / 100);
            const nextDate  = sc?.start_date
              ? new Date(sc.start_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
              : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            const vars = { organization: venueName, customer_name: customerName, amount: subAmtFmt, frequency: sc?.frequency || 'recurring', next_payment_date: nextDate };
            await directSendEmail({ to: proposal.customer_email as string, subject: fillTemplate(tmpl.subject, vars),
              html: buildEmailHtml({ template: tmpl, vars, actionUrl: invoiceUrl, brandColor, logoUrl, venueName }) });
          }
        } else {
          const tmpl = await getVenueEmailTemplate(venue.id as string, 'payment_confirmation');
          if (tmpl) {
            const amtFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(finalChargeCents / 100);
            const vars = { organization: venueName, customer_name: customerName, amount: amtFmt,
              date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), payment_method: paymentMethod };
            await directSendEmail({ to: proposal.customer_email as string, subject: fillTemplate(tmpl.subject, vars),
              html: buildEmailHtml({ template: tmpl, vars, actionUrl: invoiceUrl, brandColor, logoUrl, venueName }) });
          }
        }
      }
    } catch (emailErr) {
      console.error('[pay] receipt email failed:', emailErr);
    }

    return NextResponse.json({ success: true, invoiceUrl: `/invoice/${proposal.id}` });
  } catch (err) {
    console.error('[pay] Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Payment failed' }, { status: 500 });
  }
}
