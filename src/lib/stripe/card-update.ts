/**
 * The couple's "update your card" link for automatic installments on a
 * venue's Stripe account (card_update_tokens → /update-card/[token]).
 * SERVER-ONLY.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { getStripe, stripePublishableKey } from '@/lib/stripe/client';
import { loadConnectVenue, venueTakesStripePayments } from '@/lib/stripe/connect';
import { acceptsBank, loadPaymentProposal, type PaymentProposal } from '@/lib/stripe/proposal-payments';

interface CardToken {
  id: string;
  venue_id: string;
  proposal_id: string | null;
  used: boolean | null;
}

/** The token's proposal when it's a Stripe payment plan that can take a new card. */
export async function stripeCardUpdateContext(token: string): Promise<{ t: CardToken; p: PaymentProposal; account: string } | null> {
  const { data } = await supabaseAdmin.from('card_update_tokens').select('id, venue_id, proposal_id, used').eq('token', token).maybeSingle();
  const t = data as CardToken | null;
  if (!t || t.used || !t.proposal_id) return null;
  const p = await loadPaymentProposal({ id: t.proposal_id });
  if (!p || p.payment_provider !== 'stripe' || !p.stripe_customer_id) return null;
  const v = await loadConnectVenue(p.venue_id);
  if (!v || !venueTakesStripePayments(v) || !v.stripe_account_id) return null;
  return { t, p, account: v.stripe_account_id };
}

export async function createCardUpdateSetup(token: string): Promise<{ clientSecret: string; publishableKey: string; stripeAccount: string } | null> {
  const ctx = await stripeCardUpdateContext(token);
  const publishableKey = stripePublishableKey();
  if (!ctx || !publishableKey) return null;
  const v = await loadConnectVenue(ctx.p.venue_id);
  const si = await getStripe().setupIntents.create(
    {
      customer: ctx.p.stripe_customer_id as string,
      usage: 'off_session',
      payment_method_types: v && acceptsBank(ctx.p, v) ? ['card', 'us_bank_account'] : ['card'],
      metadata: { storyvenue_proposal_id: ctx.p.id, purpose: 'installment_card_update' },
    },
    { stripeAccount: ctx.account },
  );
  if (!si.client_secret) return null;
  return { clientSecret: si.client_secret, publishableKey, stripeAccount: ctx.account };
}

/**
 * Save the new card on the payment plan and queue any missed installment to
 * be charged again on the next hourly run.
 */
export async function saveCardUpdate(token: string, setupIntentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await stripeCardUpdateContext(token);
  if (!ctx) return { ok: false, error: 'This link is no longer valid.' };
  const si = await getStripe().setupIntents.retrieve(setupIntentId, {}, { stripeAccount: ctx.account });
  const customer = typeof si.customer === 'string' ? si.customer : si.customer?.id;
  const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
  if (si.status !== 'succeeded' || !pm || customer !== ctx.p.stripe_customer_id) {
    return { ok: false, error: 'Your card couldn’t be saved. Please try again.' };
  }
  await supabaseAdmin.from('proposals').update({ stripe_payment_method_id: pm }).eq('id', ctx.p.id);
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('proposal_installments')
    .update({ status: 'scheduled', attempts: 0, next_attempt_at: now, last_error: null, updated_at: now })
    .eq('proposal_id', ctx.p.id)
    .eq('status', 'failed');
  await supabaseAdmin
    .from('proposal_installments')
    .update({ next_attempt_at: now, updated_at: now })
    .eq('proposal_id', ctx.p.id)
    .eq('status', 'scheduled')
    .gt('attempts', 0);
  await supabaseAdmin.from('card_update_tokens').update({ used: true }).eq('id', ctx.t.id);
  return { ok: true };
}
