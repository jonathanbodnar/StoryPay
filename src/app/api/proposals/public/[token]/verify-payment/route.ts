import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCheckoutSession, createPaymentSchedule, createSubscription } from '@/lib/lunarpay';
import { sendEmail as directSendEmail } from '@/lib/email';
import { getVenueEmailTemplate, buildEmailHtml, fillTemplate } from '@/lib/email-templates';
import { syncPaymentRemindersForProposal } from '@/lib/payment-reminders';
import { onMarketingProposalPaid } from '@/lib/marketing-email-worker';
import { applySystemTagByEmail, ensureSystemTagsForVenue } from '@/lib/system-tags';
import { notifyOwner, formatAmount, HIGH_VALUE_THRESHOLD_CENTS } from '@/lib/owner-notifications';
import { dispatchIntegrationEvent } from '@/lib/integration-events';

function applyFee(cents: number, ratePercent: number): number {
  if (ratePercent <= 0) return cents;
  return Math.round(cents * (1 + ratePercent / 100));
}

interface Installment {
  amount: number;
  date: string;
}

interface InstallmentConfig {
  installments: Installment[];
}

interface SubscriptionConfig {
  amount: number;
  frequency: string;
  start_date: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { session_id } = await request.json();

  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select(
      'id, venue_id, status, payment_type, payment_config, customer_name, customer_email, customer_phone, customer_lunarpay_id, price',
    )
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (proposal.status === 'paid') {
    return NextResponse.json({ success: true, already_paid: true });
  }

  // Concurrency guard: stamp verify_session_id on this row so only one
  // request gets to run the side-effects (subscription create, schedule
  // create, receipt email, integration events, etc.). If two requests arrive
  // in parallel (browser refresh + LunarPay webhook, double-click) only the
  // first one to update the column wins; the others bail with already_paid.
  // Best-effort: column is added by migration 121 but if it doesn't exist
  // yet we fall through to existing behavior.
  try {
    const { data: claimed } = await supabaseAdmin
      .from('proposals')
      .update({ verify_session_id: session_id })
      .eq('id', proposal.id)
      .is('verify_session_id', null)
      .select('id')
      .maybeSingle();
    if (!claimed) {
      // Another concurrent request already claimed this proposal.
      return NextResponse.json({ success: true, already_paid: true });
    }
  } catch {
    // verify_session_id column missing on older DBs — log and proceed
    console.warn('[verify-payment] verify_session_id column missing; concurrency guard disabled');
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, lunarpay_secret_key, name, ghl_access_token, ghl_location_id, service_fee_rate')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  try {
    const result = await getCheckoutSession(venue.lunarpay_secret_key, session_id);
    const session = result.data || result;

    console.log('[verify-payment] Checkout session response:', JSON.stringify(session, null, 2));

    if (session.status !== 'completed') {
      // Notify the venue owner that a payment attempt failed (gated by toggles).
      // Awaited because serverless runtimes can cancel fire-and-forget promises
      // after the response is returned.
      await notifyOwner({
        venueId: proposal.venue_id as string,
        scenario: 'payment_failed',
        vars: {
          customer_name: proposal.customer_name || 'Customer',
          amount:        formatAmount(proposal.price),
          reason:        String(session.status || 'unknown'),
        },
        actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io'}/dashboard/transactions`,
      });
      // Apply payment_failed system tag (fire-and-forget)
      if (proposal.venue_id && proposal.customer_email) {
        ensureSystemTagsForVenue(proposal.venue_id as string)
          .then(() => applySystemTagByEmail(proposal.venue_id as string, proposal.customer_email as string, 'payment_failed'))
          .catch(() => {});
      }
      return NextResponse.json(
        { error: 'Payment not completed', status: session.status },
        { status: 400 }
      );
    }

    const customerId = session.customer_id || session.customerId || proposal.customer_lunarpay_id;
    const paymentMethodId = session.payment_method_id || session.paymentMethodId || session.payment_method;
    const feeRate = Number(venue.service_fee_rate ?? 0);
    const addFee = feeRate > 0;

    console.log('[verify-payment] customerId:', customerId, 'paymentMethodId:', paymentMethodId);
    console.log('[verify-payment] payment_type:', proposal.payment_type, 'feeRate:', feeRate, '%');
    console.log('[verify-payment] payment_config:', JSON.stringify(proposal.payment_config));

    // Pull the LP charge id off the completed session. LP returns it under
    // a few different shapes depending on payload version, so try them all.
    // We need this on `proposals.charge_id` for /api/transactions/refund to
    // hit POST /api/v1/charges/{chargeId}/refund.
    const sessionCharge = (session.charge as Record<string, unknown> | null) || null;
    const sessionCharges = Array.isArray(session.charges) ? session.charges : null;
    const firstCharge = sessionCharges
      ? (sessionCharges[0] as Record<string, unknown> | undefined)
      : undefined;
    const chargeIdFromSession =
      (session.charge_id as string | number | null) ??
      (session.chargeId as string | number | null) ??
      (sessionCharge?.id as string | number | null | undefined) ??
      (firstCharge?.id as string | number | null | undefined) ??
      null;
    const transactionId =
      (session.transaction_id as string | number | null) ??
      (session.transactionId as string | number | null) ??
      null;

    const updateData: Record<string, unknown> = {
      status: 'paid',
      paid_at: session.paid_at || session.paidAt || new Date().toISOString(),
      checkout_session_id: session_id,
      transaction_id: transactionId,
      // LP's /charges/{id}/refund endpoint expects the charge id; if the
      // session didn't surface one, fall back to the transaction id (some
      // LP responses use the same value in both fields).
      charge_id: chargeIdFromSession ?? transactionId,
    };

    if (proposal.payment_type === 'installment' && proposal.payment_config) {
      const config = proposal.payment_config as InstallmentConfig;
      const allInstallments = config.installments || [];
      const remaining = allInstallments.slice(1);

      console.log('[verify-payment] Total installments:', allInstallments.length, 'Remaining:', remaining.length);

      if (remaining.length > 0) {
        if (!customerId) {
          console.error('[verify-payment] Cannot create payment schedule: no customer_id from checkout session or proposal');
        } else if (!paymentMethodId) {
          console.error('[verify-payment] Cannot create payment schedule: no payment_method_id from checkout session');
        } else {
          try {
            const schedulePayload = {
              customerId: Number(customerId),
              paymentMethodId: Number(paymentMethodId),
              description: `${proposal.customer_name} - Installment plan`,
              payments: remaining.map((p) => ({
                amount: addFee ? applyFee(p.amount, feeRate) : p.amount,
                date: p.date,
              })),
            };

            console.log('[verify-payment] Creating payment schedule:', JSON.stringify(schedulePayload, null, 2));

            const scheduleResult = await createPaymentSchedule(venue.lunarpay_secret_key, schedulePayload);
            const schedule = scheduleResult.data || scheduleResult;

            console.log('[verify-payment] Payment schedule created:', JSON.stringify(schedule));
            updateData.payment_schedule_id = schedule.id;
          } catch (scheduleErr) {
            console.error('[verify-payment] Failed to create payment schedule:', scheduleErr);
            console.error('[verify-payment] Error details:', scheduleErr instanceof Error ? scheduleErr.message : String(scheduleErr));
          }
        }
      }
    }

    if (proposal.payment_type === 'subscription' && proposal.payment_config) {
      const config = proposal.payment_config as SubscriptionConfig;

      if (!customerId || !paymentMethodId) {
        console.error('[verify-payment] Cannot create subscription: customerId=', customerId, 'paymentMethodId=', paymentMethodId);
      } else {
        try {
          const subPayload = {
            customerId: Number(customerId),
            paymentMethodId: Number(paymentMethodId),
            amount: addFee ? applyFee(config.amount, feeRate) : config.amount,
            frequency: config.frequency,
            startOn: config.start_date,
            description: `${proposal.customer_name} - ${config.frequency} subscription`,
          };

          console.log('[verify-payment] Creating subscription:', JSON.stringify(subPayload, null, 2));

          const subResult = await createSubscription(venue.lunarpay_secret_key, subPayload);
          const sub = subResult.data || subResult;
          updateData.subscription_id = sub.id;
          console.log('[verify-payment] Subscription created:', sub.id);
        } catch (subErr) {
          console.error('[verify-payment] Failed to create subscription:', subErr);
        }
      }
    }

    await supabaseAdmin
      .from('proposals')
      .update(updateData)
      .eq('id', proposal.id);

    void syncPaymentRemindersForProposal(proposal.id);
    void onMarketingProposalPaid(proposal.venue_id as string, proposal.customer_email as string | null);

    // Auto-apply payment system tags
    if (proposal.venue_id && proposal.customer_email) {
      const vId = proposal.venue_id as string;
      const cEmail = proposal.customer_email as string;
      const payType = (proposal.payment_type as string | null) || 'full';
      const isFullPayment = payType === 'full';
      const isPaymentPlan = payType === 'subscription' || payType === 'installment';
      ensureSystemTagsForVenue(vId).then(() => {
        applySystemTagByEmail(vId, cEmail, 'deposit_paid').catch(() => {});
        if (isFullPayment) {
          applySystemTagByEmail(vId, cEmail, 'paid_in_full').catch(() => {});
          applySystemTagByEmail(vId, cEmail, 'closed_won').catch(() => {});
          applySystemTagByEmail(vId, cEmail, 'date_confirmed').catch(() => {});
        }
        if (isPaymentPlan) {
          applySystemTagByEmail(vId, cEmail, 'payment_plan_active').catch(() => {});
        }
      }).catch(() => {});
    }

    // Fan out to Zapier / external integrations subscribed to payment.received
    if (proposal.venue_id) {
      void dispatchIntegrationEvent(proposal.venue_id as string, 'payment.received', {
        payment: {
          proposal_id: proposal.id,
          customer_name: (proposal.customer_name as string | null) || '',
          customer_email: (proposal.customer_email as string | null) || '',
          customer_phone: (proposal.customer_phone as string | null) || '',
          amount_cents: (proposal.price as number | null) ?? 0,
          amount_dollars: formatAmount(proposal.price as number | null),
          payment_type: (proposal.payment_type as string | null) || 'full',
          paid_at: new Date().toISOString(),
        },
      });
    }

    console.log('[verify-payment] Proposal updated:', JSON.stringify(updateData));

    // Send customer receipt email using the venue's saved template.
    // Subscription payments get the dedicated subscription_confirmation template;
    // all other payment types (full, installment) get the payment_confirmation template.
    try {
      const { data: fullProposal } = await supabaseAdmin
        .from('proposals')
        .select('customer_email, customer_name, price, public_token, payment_type, payment_config')
        .eq('id', proposal.id)
        .single();

      if (fullProposal?.customer_email && venue?.id) {
        const { data: brandData } = await supabaseAdmin
          .from('venues')
          .select('brand_color, brand_logo_url')
          .eq('id', venue.id)
          .single();

        const appUrl      = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
        const venueName   = venue.name || 'Your Venue';
        const invoiceUrl  = `${appUrl}/proposal/${fullProposal.public_token}`;
        const brandColor  = brandData?.brand_color   || '#1b1b1b';
        const logoUrl     = brandData?.brand_logo_url || undefined;
        const amountFormatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
          .format((fullProposal.price || 0) / 100);

        const isSubscription = (fullProposal.payment_type as string) === 'subscription';

        if (isSubscription) {
          // ── Subscription confirmation to customer ──────────────────────────
          const subCfg = (fullProposal.payment_config as { amount?: number; frequency?: string; start_date?: string } | null) ?? {};
          const subAmountFormatted = subCfg.amount
            ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(subCfg.amount / 100)
            : amountFormatted;
          const nextPaymentDate = subCfg.start_date
            ? new Date(subCfg.start_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
            : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

          const subTmpl = await getVenueEmailTemplate(venue.id, 'subscription_confirmation');
          if (subTmpl) {
            const vars: Record<string, string> = {
              organization:      venueName,
              customer_name:     fullProposal.customer_name || 'there',
              amount:            subAmountFormatted,
              frequency:         subCfg.frequency || 'recurring',
              next_payment_date: nextPaymentDate,
            };
            await directSendEmail({
              to:      fullProposal.customer_email,
              subject: fillTemplate(subTmpl.subject, vars),
              html:    buildEmailHtml({
                template:   subTmpl,
                vars,
                actionUrl:  invoiceUrl,
                brandColor,
                logoUrl,
                venueName,
              }),
            });
            console.log('[verify-payment] Subscription confirmation email sent to', fullProposal.customer_email);
          }
        } else {
          // ── Standard payment confirmation to customer ──────────────────────
          const tmpl = await getVenueEmailTemplate(venue.id, 'payment_confirmation');
          if (tmpl) {
            const vars: Record<string, string> = {
              organization:   venueName,
              customer_name:  fullProposal.customer_name || 'there',
              amount:         amountFormatted,
              date:           new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
              payment_method: '',
            };
            await directSendEmail({
              to:      fullProposal.customer_email,
              subject: fillTemplate(tmpl.subject, vars),
              html:    buildEmailHtml({
                template:   tmpl,
                vars,
                actionUrl:  invoiceUrl,
                brandColor,
                logoUrl,
                venueName,
              }),
            });
            console.log('[verify-payment] Receipt email sent to', fullProposal.customer_email);
          }
        }
      }
    } catch (emailErr) {
      console.error('[verify-payment] Failed to send receipt email:', emailErr);
    }

    // ── Owner-side notifications (email + SMS), gated by /dashboard/settings/notifications toggles
    //
    // All notifyOwner calls are awaited (not fire-and-forget) because in
    // serverless runtimes any unfinished promises after the response returns
    // can be suspended/cancelled, silently dropping the email/SMS. notifyOwner
    // internally wraps everything in try/catch and never throws, so awaiting
    // is safe.
    try {
      const { data: fp } = await supabaseAdmin
        .from('proposals')
        .select('customer_name, price, public_token')
        .eq('id', proposal.id)
        .single();
      const amountCents  = Number(fp?.price ?? 0);
      const customerName = (fp?.customer_name as string | null) || 'Customer';
      const appUrl       = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
      const dashUrl      = `${appUrl}/dashboard/transactions`;

      // 1. Subscription created
      if (proposal.payment_type === 'subscription' && proposal.payment_config) {
        const cfg = proposal.payment_config as SubscriptionConfig;
        await notifyOwner({
          venueId: proposal.venue_id as string,
          scenario: 'subscription_created',
          vars: {
            customer_name: customerName,
            amount:        formatAmount(cfg.amount),
            frequency:     String(cfg.frequency || ''),
          },
          actionUrl: dashUrl,
        });
      }

      // 2. Payment received (always for full / installment first payment / subscription start)
      await notifyOwner({
        venueId: proposal.venue_id as string,
        scenario: 'payment_received',
        vars: {
          customer_name: customerName,
          amount:        formatAmount(amountCents),
        },
        actionUrl:    dashUrl,
        alsoHighValue: amountCents >= HIGH_VALUE_THRESHOLD_CENTS,
      });

      // 3. Separate high-value SMS scenario (gated by sms_high_value_payment)
      if (amountCents >= HIGH_VALUE_THRESHOLD_CENTS) {
        await notifyOwner({
          venueId: proposal.venue_id as string,
          scenario: 'high_value_payment',
          vars: {
            customer_name: customerName,
            amount:        formatAmount(amountCents),
          },
          actionUrl: dashUrl,
        });
      }
    } catch (notifyErr) {
      console.error('[verify-payment] Failed to notify owner:', notifyErr);
    }

    // Surface the payment method (cc / ach) so the success page can show
    // the right copy ("Payment received" vs "Bank payment processing").
    const paymentMethodKind: 'cc' | 'ach' | 'unknown' =
      (session.payment_method as string)?.toLowerCase() === 'ach' ||
      (session.paymentMethod as string)?.toLowerCase() === 'ach'
        ? 'ach'
        : (session.payment_method as string)?.toLowerCase() === 'cc' ||
          (session.paymentMethod as string)?.toLowerCase() === 'cc'
          ? 'cc'
          : 'unknown';

    return NextResponse.json({ success: true, payment_method: paymentMethodKind });
  } catch (err) {
    console.error('[verify-payment] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to verify payment' },
      { status: 500 }
    );
  }
}
