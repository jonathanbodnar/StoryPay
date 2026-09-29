/**
 * Stripe events from venues' own Stripe accounts (Stripe Connect). SERVER-ONLY.
 *
 *   payment_intent.*   a couple's payment settled, is clearing, or bounced
 *                      (bank payments settle days after they're submitted)
 *   charge.refunded    a refund made from the venue's Stripe dashboard
 *   account.updated    the venue's Stripe account changed (approval, new requirements)
 *
 * Each event is processed once (stripe_events). Everything here is idempotent,
 * because the proposal page and the daily installment job record the same
 * payments as they happen.
 */

import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { syncConnectedAccount } from '@/lib/stripe/connect';
import { finalizeFirstPayment, onFirstPaymentFailed, onInstallmentIntentUpdate } from '@/lib/stripe/proposal-payments';

async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const { data: existing } = await supabaseAdmin.from('stripe_events').select('id, processed_at').eq('id', event.id).maybeSingle();
  if ((existing as { processed_at?: string | null } | null)?.processed_at) return false;
  if (!existing) {
    const { error } = await supabaseAdmin.from('stripe_events').insert({ id: event.id, type: event.type, account: event.account ?? null });
    if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
  }
  return true;
}

async function finishEvent(eventId: string, error?: string): Promise<void> {
  await supabaseAdmin
    .from('stripe_events')
    .update(error ? { error: error.slice(0, 1000) } : { processed_at: new Date().toISOString(), error: null })
    .eq('id', eventId);
}

async function onPaymentIntent(event: Stripe.Event): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;
  if (pi.metadata?.storyvenue_installment_id) {
    await onInstallmentIntentUpdate(pi);
    return;
  }
  const proposalId = pi.metadata?.storyvenue_proposal_id;
  if (!proposalId) return; // not a StoryVenue payment (e.g. the venue's own Stripe activity)
  if (event.type === 'payment_intent.payment_failed') await onFirstPaymentFailed(proposalId, pi);
  else await finalizeFirstPayment(proposalId, pi);
}

/** A refund issued from the venue's own Stripe dashboard: keep the proposal's status in step. */
async function onChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return;
  const status = charge.refunded ? 'refunded' : 'partial_refund';
  await supabaseAdmin
    .from('proposals')
    .update({ status, refunded_at: new Date().toISOString() })
    .eq('stripe_payment_intent_id', pi)
    .neq('status', 'refunded');
}

async function onAccountUpdated(event: Stripe.Event): Promise<void> {
  if (!event.account) return;
  const { data } = await supabaseAdmin.from('venues').select('id').eq('stripe_account_id', event.account).maybeSingle();
  const venueId = (data as { id?: string } | null)?.id;
  if (venueId) await syncConnectedAccount(venueId);
}

export async function handleConnectEvent(event: Stripe.Event): Promise<void> {
  if (!(await claimEvent(event))) return;
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.processing':
      case 'payment_intent.payment_failed':
        await onPaymentIntent(event);
        break;
      case 'charge.refunded':
        await onChargeRefunded(event);
        break;
      case 'account.updated':
        await onAccountUpdated(event);
        break;
      default:
        break;
    }
    await finishEvent(event.id);
  } catch (e) {
    await finishEvent(event.id, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Keep in sync with scripts/stripe-setup.mjs --connect. */
export const STRIPE_CONNECT_WEBHOOK_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.processing',
  'payment_intent.payment_failed',
  'charge.refunded',
  'account.updated',
] as const;
