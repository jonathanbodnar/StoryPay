/**
 * Stripe events for StoryVenue SaaS billing. Status comes from here — no polling.
 *
 * The owner's Stripe account also bills private clients directly, so every
 * handler first checks that the subscription is a StoryVenue software
 * subscription (metadata.sv_kind = 'saas', or the id is linked on a venue row)
 * and ignores everything else.
 */

import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe/client';
import {
  SAAS_KIND,
  applyCheckoutSession,
  loadBillingVenue,
  recordStripeBillingEvent,
  venueStatusFor,
  type BillingVenue,
} from '@/lib/stripe/billing';
import { scheduleOwnerGhlSync } from '@/lib/owner-ghl-sync';

/** Record the event; false when it was already processed (duplicate delivery). */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const { data: existing } = await supabaseAdmin
    .from('stripe_events')
    .select('id, processed_at')
    .eq('id', event.id)
    .maybeSingle();
  if ((existing as { processed_at?: string | null } | null)?.processed_at) return false;
  if (!existing) {
    const { error } = await supabaseAdmin.from('stripe_events').insert({ id: event.id, type: event.type });
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

/**
 * The venue a SaaS subscription belongs to, or null when it isn't one of ours.
 * A venue still on LunarPay is mid-move (lunarpay-migration.ts writes its row
 * once LunarPay is stopped, and undoes the Stripe side if it can't be), so
 * subscription events leave it alone.
 */
async function venueForSubscriptionChange(sub: Stripe.Subscription): Promise<BillingVenue | null> {
  const v = await venueForSubscription(sub);
  return v && v.billing_provider !== 'lunarpay' ? v : null;
}

async function venueForSubscription(sub: Stripe.Subscription): Promise<BillingVenue | null> {
  const metaVenue = sub.metadata?.sv_kind === SAAS_KIND ? sub.metadata?.storyvenue_venue_id : null;
  if (metaVenue) {
    const v = await loadBillingVenue(metaVenue);
    if (v) return v;
  }
  const { data } = await supabaseAdmin.from('venues').select('id').eq('stripe_subscription_id', sub.id).maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  return id ? loadBillingVenue(id) : null;
}

function subscriptionIdOfInvoice(inv: Stripe.Invoice): string | null {
  const fromParent = inv.parent?.subscription_details?.subscription;
  if (fromParent) return typeof fromParent === 'string' ? fromParent : fromParent.id;
  const legacy = (inv as unknown as { subscription?: string | { id: string } | null }).subscription;
  if (legacy) return typeof legacy === 'string' ? legacy : legacy.id;
  return null;
}

async function onSubscriptionChanged(sub: Stripe.Subscription): Promise<void> {
  const v = await venueForSubscriptionChange(sub);
  if (!v) return;
  // Only the subscription the venue is tracking may change its status (a stale
  // or replaced subscription must not flip it back).
  if (v.stripe_subscription_id && v.stripe_subscription_id !== sub.id) return;
  if (sub.status === 'canceled' || sub.status === 'incomplete_expired') return; // handled by deleted
  const status = venueStatusFor(sub);
  const patch: Record<string, unknown> = {
    billing_provider: 'stripe',
    stripe_subscription_id: sub.id,
    directory_subscription_external_id: sub.id,
    directory_subscription_status: status,
  };
  if (status === 'active' && !sub.cancel_at) patch.directory_downgrade_at = null;
  await supabaseAdmin.from('venues').update(patch).eq('id', v.id);
  if (status !== v.directory_subscription_status) scheduleOwnerGhlSync(v.id);
}

async function onSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const v = await venueForSubscriptionChange(sub);
  if (!v || v.stripe_subscription_id !== sub.id) return; // already cleared by our own cancel path
  if (v.directory_downgrade_at || sub.cancel_at_period_end) {
    // The venue cancelled and the term it paid for (or its trial) just ended:
    // it moves to Free and stays on the platform.
    const { applyFreeDowngrade } = await import('@/lib/venue-billing');
    await supabaseAdmin.from('venues').update({ stripe_subscription_id: null, directory_subscription_external_id: null }).eq('id', v.id);
    await applyFreeDowngrade(v.id);
    return;
  }
  await supabaseAdmin
    .from('venues')
    .update({ directory_subscription_status: 'canceled', directory_subscription_external_id: null, stripe_subscription_id: null })
    .eq('id', v.id);
  await recordStripeBillingEvent({
    venueId: v.id, planId: v.directory_plan_id, amountCents: 0, eventType: 'subscription_cancel',
    externalEventId: `stripe_sub_deleted:${sub.id}`, metadata: { subscription_id: sub.id, reason: 'stripe_canceled' },
  });
  scheduleOwnerGhlSync(v.id);
}

async function onInvoicePaid(inv: Stripe.Invoice): Promise<void> {
  const subId = subscriptionIdOfInvoice(inv);
  if (!subId || !inv.id) return;
  const sub = await getStripe().subscriptions.retrieve(subId);
  const v = await venueForSubscription(sub);
  if (!v || (v.stripe_subscription_id && v.stripe_subscription_id !== sub.id)) return;
  const amount = inv.amount_paid ?? 0;
  if (amount <= 0) return; // the $0 invoice that opens a trial — status stays trialing
  const prev = String(v.directory_subscription_status ?? '');
  // The receipt: the first charge after the trial and a payment that clears a
  // decline, once per invoice. Not only by the status before this event:
  // Stripe's subscription update (status active) often lands first, and the
  // receipt was then skipped.
  const events = (type: string) =>
    supabaseAdmin.from('platform_billing_events').select('id', { count: 'exact', head: true }).eq('venue_id', v.id).eq('event_type', type);
  const [{ count: charges }, { count: thisInvoice }, { count: declines }] = await Promise.all([
    events('charge_success'),
    events('charge_success').eq('stripe_invoice_id', inv.id),
    events('payment_failed').eq('stripe_invoice_id', inv.id),
  ]);
  await supabaseAdmin
    .from('venues')
    .update({
      billing_provider: 'stripe',
      stripe_subscription_id: sub.id,
      directory_subscription_external_id: sub.id,
      directory_subscription_status: 'active',
      directory_trial_consumed: true,
      ...(sub.cancel_at ? {} : { directory_downgrade_at: null }),
    })
    .eq('id', v.id);
  await recordStripeBillingEvent({
    venueId: v.id, planId: v.directory_plan_id, amountCents: amount, eventType: 'charge_success',
    externalEventId: `stripe_inv:${inv.id}`, invoiceId: inv.id,
    metadata: { subscription_id: sub.id, billing_reason: inv.billing_reason, hosted_invoice_url: inv.hosted_invoice_url },
  });
  if (!thisInvoice && (prev === 'trialing' || prev === 'past_due' || !charges || !!declines)) {
    const { notifyVenueSubscriptionCharged } = await import('@/lib/saas-billing-notifications');
    void notifyVenueSubscriptionCharged(v.id, amount).catch(() => {});
  }
  scheduleOwnerGhlSync(v.id);
}

async function onInvoicePaymentFailed(inv: Stripe.Invoice): Promise<void> {
  const subId = subscriptionIdOfInvoice(inv);
  if (!subId || !inv.id) return;
  const sub = await getStripe().subscriptions.retrieve(subId);
  const v = await venueForSubscription(sub);
  if (!v || (v.stripe_subscription_id && v.stripe_subscription_id !== sub.id)) return;
  // One card-declined email per failed invoice. Not "only when the venue
  // wasn't past_due yet": Stripe's subscription update (status past_due)
  // often lands first, and the email was then skipped.
  const { count: earlierFailures } = await supabaseAdmin
    .from('platform_billing_events')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', v.id)
    .eq('event_type', 'payment_failed')
    .eq('stripe_invoice_id', inv.id);
  await supabaseAdmin.from('venues').update({ directory_subscription_status: 'past_due' }).eq('id', v.id);
  await recordStripeBillingEvent({
    venueId: v.id, planId: v.directory_plan_id, amountCents: 0, eventType: 'payment_failed',
    externalEventId: `stripe_inv_failed:${inv.id}:${inv.attempt_count ?? 0}`, invoiceId: inv.id,
    metadata: { subscription_id: sub.id, attempt_count: inv.attempt_count, amount_due: inv.amount_due },
  });
  if (!earlierFailures) {
    const { notifyVenueCardDeclined } = await import('@/lib/saas-billing-notifications');
    void notifyVenueCardDeclined(v.id).catch(() => {});
  }
  scheduleOwnerGhlSync(v.id);
}

async function onTrialWillEnd(sub: Stripe.Subscription): Promise<void> {
  const v = await venueForSubscriptionChange(sub);
  if (!v || v.stripe_subscription_id !== sub.id) return;
  if (v.directory_trial_reminder_sent_at || v.directory_downgrade_at) return; // sent already / chose Free
  const amount = sub.items.data.reduce((s, it) => s + (it.price.unit_amount ?? 0) * (it.quantity ?? 1), 0);
  const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : v.directory_trial_ends_at;
  const daysLeft = trialEndsAt ? Math.max(1, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000)) : 3;
  const { notifyVenueTrialEndingSoon } = await import('@/lib/saas-billing-notifications');
  await notifyVenueTrialEndingSoon(v.id, { trialEndsAt, amountCents: amount, daysLeft }).catch(() => {});
  await supabaseAdmin.from('venues').update({ directory_trial_reminder_sent_at: new Date().toISOString() }).eq('id', v.id);
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (!(await claimEvent(event))) return;
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.metadata?.sv_kind === SAAS_KIND) await applyCheckoutSession(s.id);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await onSubscriptionChanged(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.trial_will_end':
        await onTrialWillEnd(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid':
        await onInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await onInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        break;
    }
    await finishEvent(event.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishEvent(event.id, msg);
    throw e;
  }
}

export const STRIPE_WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
];
