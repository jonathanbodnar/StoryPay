import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  createCustomer,
  listCustomers,
  savePaymentMethod,
  createCharge,
  createPaymentSchedule,
} from '@/lib/lunarpay';

import { sendEmail as directSendEmail } from '@/lib/email';
import { getVenueEmailTemplate, buildEmailHtml, fillTemplate } from '@/lib/email-templates';
import { syncPaymentRemindersForProposal } from '@/lib/payment-reminders';
import { onMarketingProposalPaid } from '@/lib/marketing-email-worker';
import { applySystemTagByEmail, ensureSystemTagsForVenue } from '@/lib/system-tags';
import { notifyOwner, formatAmount, HIGH_VALUE_THRESHOLD_CENTS } from '@/lib/owner-notifications';
import { dispatchIntegrationEvent } from '@/lib/integration-events';

/** Pull a numeric id out of common LP response shapes. */
function extractId(raw: unknown): number {
  const r    = (raw ?? {}) as Record<string, unknown>;
  const root = (r.data ?? r) as Record<string, unknown>;
  const pm   = (root.payment_method ?? root) as Record<string, unknown>;
  const id   = pm.id ?? root.id ?? r.id;
  return Number(id);
}

/** Pull whatever Fortis decided to call the transaction id out of the `done` payload. */
function extractTransactionId(done: Record<string, unknown> | null | undefined): string | null {
  if (!done) return null;
  const d = done as Record<string, unknown>;
  const t = (d.transaction ?? d.data ?? {}) as Record<string, unknown>;
  const id = d.transaction_id ?? d.transactionId ?? t.id ?? t.transactionId ?? t.transaction_id ?? d.id;
  return id != null ? String(id) : null;
}

interface InstallmentConfig { installments: Array<{ amount: number; date: string }>; }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Payload shapes:
  //   • full        → { done: <Fortis done payload>, paymentMethod? }
  //   • installment → { ticketId: string, paymentMethod? }
  let body: {
    ticketId?: string;
    done?: Record<string, unknown> | null;
    paymentMethod?: string;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const paymentMethod = body.paymentMethod ?? 'cc';

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, venue_id, status, price, customer_name, customer_email, customer_lunarpay_id, payment_type, payment_config, template_id, public_token')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  const isInvoice = !proposal.template_id;
  const allowedStatuses = isInvoice ? ['sent', 'opened', 'signed'] : ['signed'];
  if (!allowedStatuses.includes(proposal.status as string)) {
    if (proposal.status === 'paid') return NextResponse.json({ success: true, already_paid: true });
    return NextResponse.json({ error: 'Proposal not ready for payment' }, { status: 400 });
  }

  const paymentType = (proposal.payment_type as string) || 'full';
  if (paymentType !== 'full' && paymentType !== 'installment') {
    return NextResponse.json({ error: `Unsupported payment_type "${paymentType}"` }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, lunarpay_secret_key, brand_color, brand_logo_url')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  const sk     = venue.lunarpay_secret_key as string;
  const config = proposal.payment_config as Record<string, unknown> | null;

  // The price (or per-installment amount) is the final figure to charge —
  // processing fee was rolled into the proposal at creation time. No more
  // fee math here; charge it as-is.
  let finalChargeCents: number = proposal.price as number;
  if (paymentType === 'installment') {
    const ic = config as InstallmentConfig | null;
    finalChargeCents = ic?.installments?.[0]?.amount ?? (proposal.price as number);
  }

  const updateData: Record<string, unknown> = {
    status:  'paid',
    paid_at: new Date().toISOString(),
  };

  try {
    if (paymentType === 'full') {
      // ── FULL: Fortis already charged inside the iframe via a transaction
      //    intention. We just record the result and mark the invoice paid.
      const txnId = extractTransactionId(body.done);
      if (!txnId) {
        console.warn('[pay] full flow: no transaction id in done payload', body.done);
      }
      updateData.charge_id      = txnId;
      updateData.transaction_id = txnId;
      console.log('[pay] full: recorded transaction', txnId);

    } else {
      // ── INSTALLMENT: ticket intention → save card → charge first → schedule rest.
      if (!body.ticketId) {
        return NextResponse.json({ error: 'ticketId is required for installment payments' }, { status: 400 });
      }

      // Resolve LP customer.
      let customerId: number = proposal.customer_lunarpay_id ? Number(proposal.customer_lunarpay_id) : 0;
      if (!customerId && proposal.customer_email) {
        try {
          const res  = await listCustomers(sk, proposal.customer_email as string);
          const list = Array.isArray(res) ? res : ((res as Record<string, unknown>).data as Record<string, unknown>[] ?? []);
          const match = list.find((c) => c.email === proposal.customer_email);
          if (match?.id) customerId = Number(match.id);
        } catch { /* will create below */ }
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
      updateData.customer_lunarpay_id = customerId;

      // Save the card → paymentMethodId ($0.01 tokenize + instant refund per LP).
      const pmRes = await savePaymentMethod(
        sk, customerId, body.ticketId,
        (proposal.customer_name as string) || '',
        { paymentMethod, setDefault: true },
      );
      const paymentMethodId = extractId(pmRes);
      console.log('[pay] installment: paymentMethodId', paymentMethodId);
      if (!paymentMethodId || Number.isNaN(paymentMethodId)) {
        throw new Error('Could not save payment method (no id from LunarPay).');
      }
      updateData.payment_method_id = paymentMethodId;

      // Charge first installment NOW.
      const ic = config as InstallmentConfig | null;
      const installCount = ic?.installments?.length || 1;
      const chargeRes = await createCharge(sk, {
        customerId,
        paymentMethodId,
        amount:      finalChargeCents,
        description: `${venue.name} - Payment 1 of ${installCount}`,
      });
      const chargeId = extractId(chargeRes);
      console.log('[pay] installment: first charge created', chargeId);
      updateData.charge_id      = chargeId;
      updateData.transaction_id = chargeId;

      // Schedule remaining installments at their as-stored amounts (no fee math).
      const remaining = (ic?.installments ?? []).slice(1);
      if (remaining.length > 0) {
        const sr = await createPaymentSchedule(sk, {
          customerId,
          paymentMethodId,
          description: `${proposal.customer_name} - Installment plan`,
          payments: remaining.map((p) => ({ amount: p.amount, date: p.date })),
        });
        updateData.payment_schedule_id = extractId(sr);
      }
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
        if (paymentType === 'installment') {
          applySystemTagByEmail(vId, cEmail, 'payment_plan_active').catch(() => {});
        }
      }).catch(() => {});
    }

    const customerName = (proposal.customer_name as string) || 'Customer';
    const appUrl  = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
    const dashUrl = `${appUrl}/dashboard/transactions`;

    notifyOwner({
      venueId: proposal.venue_id as string,
      scenario: 'payment_received',
      vars: { customer_name: customerName, amount: formatAmount(finalChargeCents) },
      actionUrl: dashUrl,
      alsoHighValue: finalChargeCents >= HIGH_VALUE_THRESHOLD_CENTS,
    }).catch(() => {});

    if (proposal.venue_id) {
      void dispatchIntegrationEvent(proposal.venue_id as string, 'payment.received', {
        payment: {
          proposal_id:    proposal.id,
          customer_name:  customerName,
          customer_email: proposal.customer_email || '',
          customer_phone: '',
          amount_cents:   finalChargeCents,
          amount_dollars: formatAmount(finalChargeCents),
          payment_type:   paymentType,
          paid_at:        new Date().toISOString(),
        },
      });
    }

    // Customer receipt email — fire and forget so the client isn't blocked
    // waiting on SMTP (this could otherwise hang the "Processing payment…"
    // overlay on the inline payment form for tens of seconds).
    void (async () => {
      try {
        if (proposal.customer_email && venue?.id) {
          const brandColor = ((venue as Record<string, unknown>).brand_color as string) || '#1b1b1b';
          const logoUrl    = ((venue as Record<string, unknown>).brand_logo_url as string | null) ?? undefined;
          const invoiceUrl = `${appUrl}/proposal/${proposal.public_token}`;
          const venueName  = (venue.name as string) || 'Your Venue';

          const tmpl = await getVenueEmailTemplate(venue.id as string, 'payment_confirmation');
          if (tmpl) {
            const amtFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(finalChargeCents / 100);
            const vars = {
              organization:   venueName,
              customer_name:  customerName,
              amount:         amtFmt,
              date:           new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
              payment_method: paymentMethod,
            };
            await directSendEmail({
              to:      proposal.customer_email as string,
              subject: fillTemplate(tmpl.subject, vars),
              html:    buildEmailHtml({ template: tmpl, vars, actionUrl: invoiceUrl, brandColor, logoUrl, venueName }),
            });
          }
        }
      } catch (emailErr) {
        console.error('[pay] receipt email failed:', emailErr);
      }
    })();

    return NextResponse.json({ success: true, invoiceUrl: `/invoice/${proposal.id}` });
  } catch (err) {
    console.error('[pay] Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Payment failed' }, { status: 500 });
  }
}
