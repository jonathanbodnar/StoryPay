/**
 * Move a venue's software subscription from LunarPay to the owner's Stripe
 * account without a double charge or a gap:
 *   1. Create the Stripe subscription (same plan + add-ons) whose first charge
 *      is the date LunarPay would next have charged — nothing is charged now.
 *   2. Only then cancel the LunarPay subscription. If that fails, the new
 *      Stripe subscription is cancelled again so the venue is never billed twice.
 * A past-due LunarPay venue (its next charge date has passed) is charged on
 * Stripe right away instead, since that payment is owed.
 */

import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe/client';
import {
  SAAS_KIND,
  desiredItemsFor,
  ensureStripeCustomer,
  loadBillingVenue,
  priceIdsForItems,
  recordStripeBillingEvent,
  venueStatusFor,
} from '@/lib/stripe/billing';
import { cancelSubscription, getSubscription } from '@/lib/lunarpay';
import { getPlatformLunarPaySecretKey } from '@/lib/platform-directory-billing';
import { scheduleOwnerGhlSync } from '@/lib/owner-ghl-sync';

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export interface LunarPaySubInfo {
  id: string;
  status: string;
  amountCents: number;
  nextPaymentOn: string | null;
}

export async function readLunarPaySubscription(subId: string): Promise<LunarPaySubInfo | null> {
  const secret = getPlatformLunarPaySecretKey();
  if (!secret) return null;
  try {
    const res = asRecord(await getSubscription(secret, subId));
    const raw = asRecord(res.data ?? res);
    const next =
      (raw.nextPaymentOn ?? raw.next_payment_on ?? raw.nextChargeAt ?? raw.next_charge_at ?? raw.nextPaymentDate ?? raw.next_payment_date ?? null) as string | null;
    return {
      id: String(raw.id ?? subId),
      status: String(raw.status ?? 'unknown').toLowerCase(),
      amountCents: typeof raw.amount === 'number' ? Math.round(raw.amount) : Number(raw.amount ?? 0) || 0,
      nextPaymentOn: next,
    };
  } catch {
    return null;
  }
}

export interface CardSummary {
  id: string;
  brand: string | null;
  last4: string | null;
  exp: string | null;
}

async function cardSummary(pmId: string): Promise<CardSummary | null> {
  try {
    const pm = await getStripe().paymentMethods.retrieve(pmId);
    return {
      id: pm.id,
      brand: pm.card?.brand ?? null,
      last4: pm.card?.last4 ?? null,
      exp: pm.card ? `${String(pm.card.exp_month).padStart(2, '0')}/${String(pm.card.exp_year).slice(-2)}` : null,
    };
  } catch {
    return null;
  }
}

/** The card to bill: the customer's default, else their most recent saved card. */
export async function defaultCardFor(customerId: string): Promise<CardSummary | null> {
  const stripe = getStripe();
  try {
    const cust = await stripe.customers.retrieve(customerId);
    if (!('deleted' in cust && cust.deleted)) {
      const d = (cust as Stripe.Customer).invoice_settings?.default_payment_method;
      const id = typeof d === 'string' ? d : d?.id;
      if (id) return cardSummary(id);
    }
    const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
    return list.data[0] ? cardSummary(list.data[0].id) : null;
  } catch {
    return null;
  }
}

/** Find the owner's existing Stripe customer by email without creating one. */
export async function findStripeCustomerByEmails(emails: Array<string | null | undefined>): Promise<string | null> {
  const stripe = getStripe();
  for (const raw of emails) {
    const email = (raw ?? '').trim().toLowerCase();
    if (!email) continue;
    const list = await stripe.customers.list({ email, limit: 10 });
    const live = list.data.filter((c) => !(c as unknown as { deleted?: boolean }).deleted);
    if (live.length) return (live.find((c) => c.invoice_settings?.default_payment_method) ?? live[0]).id;
  }
  return null;
}

export interface MigrationPreview {
  venueId: string;
  venueName: string | null;
  lunarpay: LunarPaySubInfo | null;
  customerId: string | null;
  card: CardSummary | null;
  stripeAmountCents: number;
  amountMatches: boolean;
  firstChargeDate: string | null;
  chargesNow: boolean;
  ready: boolean;
  blocker: string | null;
}

export async function previewMigration(
  venueId: string,
  opts: { customerId?: string | null; paymentMethodId?: string | null } = {},
): Promise<MigrationPreview> {
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  const lpSubId = v.billing_provider === 'lunarpay' || (v.directory_subscription_external_id && !String(v.directory_subscription_external_id).startsWith('sub_'))
    ? v.directory_subscription_external_id
    : null;
  const lunarpay = lpSubId ? await readLunarPaySubscription(lpSubId) : null;
  const customerId = opts.customerId ?? v.stripe_customer_id ?? (await findStripeCustomerByEmails([v.email, v.notification_email]));
  const card = opts.paymentMethodId
    ? await cardSummary(opts.paymentMethodId)
    : customerId ? await defaultCardFor(customerId) : null;
  const desired = await desiredItemsFor(v);

  const nextMs = lunarpay?.nextPaymentOn ? new Date(lunarpay.nextPaymentOn).getTime() : NaN;
  const chargesNow = !Number.isFinite(nextMs) || nextMs <= Date.now() + 3600_000;
  let blocker: string | null = null;
  if (v.billing_provider === 'stripe') blocker = 'Already billing on Stripe.';
  else if (!lpSubId) blocker = 'No LunarPay subscription on file.';
  else if (!customerId) blocker = 'No Stripe customer with this venue’s email — link one, or ask the venue to add a card.';
  else if (!card) blocker = 'The Stripe customer has no saved card — ask the venue to add one.';
  else if (desired.totalCents <= 0) blocker = 'The venue’s plan is $0 — nothing to bill.';

  return {
    venueId,
    venueName: v.name,
    lunarpay,
    customerId: customerId ?? null,
    card,
    stripeAmountCents: desired.totalCents,
    amountMatches: Boolean(lunarpay && lunarpay.amountCents === desired.totalCents),
    firstChargeDate: chargesNow ? new Date().toISOString() : new Date(nextMs).toISOString(),
    chargesNow,
    ready: blocker === null,
    blocker,
  };
}

export async function migrateVenueFromLunarPay(
  venueId: string,
  opts: { customerId?: string | null; paymentMethodId?: string | null } = {},
): Promise<{ subscriptionId: string; firstChargeDate: string }> {
  const preview = await previewMigration(venueId, opts);
  if (!preview.ready || !preview.customerId || !preview.card || !preview.lunarpay) {
    throw new Error(preview.blocker ?? 'Not ready to move.');
  }
  const v = await loadBillingVenue(venueId);
  if (!v) throw new Error('Venue not found');
  const lpSubId = preview.lunarpay.id;

  // Link the customer on the venue so ensureStripeCustomer reuses it.
  if (v.stripe_customer_id !== preview.customerId) {
    await supabaseAdmin.from('venues').update({ stripe_customer_id: preview.customerId }).eq('id', venueId);
    v.stripe_customer_id = preview.customerId;
  }
  await ensureStripeCustomer(v);

  const desired = await desiredItemsFor(v);
  const prices = await priceIdsForItems(desired.items);
  const stripe = getStripe();
  const anchor = preview.chargesNow ? null : Math.floor(new Date(preview.firstChargeDate as string).getTime() / 1000);

  const sub = await stripe.subscriptions.create(
    {
      customer: preview.customerId,
      items: prices.map((price) => ({ price })),
      default_payment_method: preview.card.id,
      ...(anchor ? { billing_cycle_anchor: anchor, proration_behavior: 'none' as const } : {}),
      payment_behavior: anchor ? 'allow_incomplete' : 'error_if_incomplete',
      description: `StoryVenue — ${desired.planName ?? 'subscription'} (monthly)`,
      metadata: {
        storyvenue_venue_id: v.id,
        sv_kind: SAAS_KIND,
        plan_id: desired.planId ?? '',
        migrated_from: 'lunarpay',
        lp_subscription_id: lpSubId,
      },
    },
    { idempotencyKey: `sv-migrate-${v.id}-${lpSubId}` },
  );

  // Stop LunarPay. If it can't be stopped, undo the Stripe side — never bill twice.
  const secret = getPlatformLunarPaySecretKey();
  try {
    if (!secret) throw new Error('LunarPay key missing — cannot cancel the old subscription.');
    await cancelSubscription(secret, lpSubId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/404|not found|no such|does not exist|already cancel/i.test(msg)) {
      await stripe.subscriptions.cancel(sub.id).catch(() => {});
      throw new Error(`Could not cancel the LunarPay subscription, so the move was undone: ${msg}`);
    }
  }

  const status = venueStatusFor(sub);
  await supabaseAdmin
    .from('venues')
    .update({
      billing_provider: 'stripe',
      stripe_customer_id: preview.customerId,
      stripe_subscription_id: sub.id,
      directory_subscription_external_id: sub.id,
      directory_subscription_status: status === 'pending' ? 'past_due' : status,
      directory_card_on_file: true,
      subscription_last_checked_at: null,
    })
    .eq('id', venueId);
  await recordStripeBillingEvent({
    venueId,
    planId: v.directory_plan_id,
    amountCents: 0,
    eventType: 'migrated_from_lunarpay',
    externalEventId: `lp_move:${lpSubId}`,
    metadata: {
      lunarpay_subscription_id: lpSubId,
      stripe_subscription_id: sub.id,
      first_charge_date: preview.firstChargeDate,
      lunarpay_amount_cents: preview.lunarpay.amountCents,
      stripe_amount_cents: preview.stripeAmountCents,
    },
  });
  scheduleOwnerGhlSync(venueId);
  return { subscriptionId: sub.id, firstChargeDate: preview.firstChargeDate as string };
}

/** Every venue still billing on LunarPay, with what a move would do. */
export async function listLunarPaySubscribers(): Promise<MigrationPreview[]> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('billing_provider', 'lunarpay')
    .order('name');
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  const out: MigrationPreview[] = [];
  for (const id of ids) {
    try {
      out.push(await previewMigration(id));
    } catch (e) {
      out.push({
        venueId: id, venueName: null, lunarpay: null, customerId: null, card: null,
        stripeAmountCents: 0, amountMatches: false, firstChargeDate: null, chargesNow: false,
        ready: false, blocker: e instanceof Error ? e.message : 'Preview failed',
      });
    }
  }
  return out;
}
