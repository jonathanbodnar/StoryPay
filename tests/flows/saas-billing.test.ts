import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import Stripe from 'stripe';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, runId, waitForEmail } from './helpers';

// Venues paying StoryVenue for the Bride Booking System™, on the platform's
// own Stripe account in TEST mode (test cards only).
const key = (process.env.STRIPE_SECRET_KEY || '').trim();
if (!key.startsWith('sk_test_')) throw new Error('Billing flow tests need the test copy’s Stripe TEST key (sk_test_).');
const stripe = new Stripe(key);

const VENUE = { id: randomUUID(), email: `billing.${runId}@example.com` };
const DAY = 86_400_000;

async function venueRow() {
  const { data } = await db.from('venues')
    .select('directory_subscription_status, stripe_customer_id, stripe_subscription_id, directory_card_on_file, billing_provider, directory_downgrade_at')
    .eq('id', VENUE.id).single();
  return data!;
}

async function waitForStatus(status: string, timeoutMs = 45_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  let current = '';
  while (Date.now() < until) {
    current = String((await venueRow()).directory_subscription_status ?? '');
    if (current === status) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  expect(current).toBe(status);
}

describe('a venue pays for the Bride Booking System™', () => {
  const owner = new Browser();
  let subId = '';
  let customer = '';

  beforeAll(async () => {
    const { data: plan } = await db.from('directory_plans').select('id').eq('slug', 'bride-booking-system').single();
    const now = Date.now();
    const { error } = await db.from('venues').insert({
      id: VENUE.id, name: `Billing Test ${runId}`, slug: `billing-test-${runId}`, email: VENUE.email,
      notification_email: VENUE.email, password_hash: await bcrypt.hash(env.password, 10),
      setup_completed: true, onboarding_status: 'registered', onboarding_completed_at: new Date(now).toISOString(),
      directory_plan_id: plan!.id, directory_subscription_status: 'trialing',
      directory_trial_started_at: new Date(now).toISOString(), directory_trial_ends_at: new Date(now + 14 * DAY).toISOString(),
      timezone: 'America/New_York', is_published: true, is_demo: false,
    });
    if (error) throw new Error(error.message);
    await owner.signIn(VENUE.email);
  });

  it('adds a card and starts the 14-day trial subscription', async () => {
    const intent = await owner.fetch('/api/venue-billing/payment-intent', { method: 'POST' });
    expect(intent.status, await intent.clone().text()).toBe(200);
    const { clientSecret, amountCents } = (await intent.json()) as { clientSecret: string; amountCents: number };
    expect(amountCents).toBe(9700);
    const setupIntentId = clientSecret.split('_secret_')[0];
    await stripe.setupIntents.confirm(setupIntentId, { payment_method: 'pm_card_visa' });

    const res = await owner.fetch('/api/venue-billing/stripe/confirm-card', { method: 'POST', json: { setupIntentId, plan: 'pro' } });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { ok: boolean; plan: string; subscription_id: string };
    expect(body).toMatchObject({ ok: true, plan: 'pro' });
    subId = body.subscription_id;

    const v = await venueRow();
    expect(v).toMatchObject({ directory_subscription_status: 'trialing', stripe_subscription_id: subId, directory_card_on_file: true, billing_provider: 'stripe' });
    customer = String(v.stripe_customer_id);
    const sub = await stripe.subscriptions.retrieve(subId);
    expect(sub.status).toBe('trialing');
    expect(Math.abs((sub.trial_end ?? 0) * 1000 - (Date.now() + 14 * DAY))).toBeLessThan(DAY);
    expect(sub.items.data.reduce((s, it) => s + (it.price.unit_amount ?? 0), 0)).toBe(9700);
  });

  it('when the trial ends, the first charge succeeds: active, with a receipt', async () => {
    const since = new Date().toISOString();
    await stripe.subscriptions.update(subId, { trial_end: 'now', proration_behavior: 'none' });
    // Stripe's "subscription active" notice often lands before "invoice paid";
    // play that order every time, so the receipt can't depend on it.
    await db.from('venues').update({ directory_subscription_status: 'active' }).eq('id', VENUE.id);
    await waitForStatus('active');
    await waitForEmail({ to: VENUE.email, since }, (e) => e.subject === 'Payment received — $97 for your Bride Booking System™');
    const { data: events } = await db.from('platform_billing_events').select('event_type, amount_cents').eq('venue_id', VENUE.id);
    expect(events?.some((e) => e.event_type === 'charge_success' && e.amount_cents === 9700)).toBe(true);
  });

  it('a declined renewal walls the dashboard; retrying with a good card pays the same invoice', async () => {
    const since = new Date().toISOString();
    const failing = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer });
    await stripe.subscriptions.update(subId, { default_payment_method: failing.id });
    // The month's renewal invoice, as Stripe makes it, charged to a card that declines.
    await stripe.invoiceItems.create({ customer, subscription: subId, amount: 9700, currency: 'usd', description: 'Renewal (test)' });
    const inv = await stripe.invoices.create({ customer, subscription: subId, auto_advance: false });
    await stripe.invoices.finalizeInvoice(inv.id!);
    await stripe.invoices.pay(inv.id!).catch(() => null); // declined
    // Same for "subscription past_due" before "payment failed": the email must still go.
    await db.from('venues').update({ directory_subscription_status: 'past_due' }).eq('id', VENUE.id);
    await waitForStatus('past_due');
    await waitForEmail({ to: VENUE.email, since }, (e) => /card was declined/.test(e.subject));

    const good = await stripe.paymentMethods.attach('pm_card_visa', { customer });
    await stripe.subscriptions.update(subId, { default_payment_method: good.id });
    const retry = await owner.fetch('/api/venue-billing/retry', { method: 'POST' });
    expect(retry.status, await retry.clone().text()).toBe(200);
    await waitForStatus('active');

    // Retrying paid that same invoice: it's the only one since the decline, and nothing is left open.
    expect((await stripe.invoices.retrieve(inv.id!)).status).toBe('paid');
    const recent = (await stripe.invoices.list({ subscription: subId, created: { gte: Math.floor(Date.parse(since) / 1000) }, limit: 10 })).data;
    expect(recent.map((i) => i.id)).toEqual([inv.id]);
    expect((await stripe.invoices.list({ subscription: subId, status: 'open' })).data).toHaveLength(0);
  });

  it('cancelling keeps the plan to the end of the paid term', async () => {
    const res = await owner.fetch('/api/venue-billing/cancel', { method: 'POST' });
    expect(res.status, await res.clone().text()).toBe(200);
    const v = await venueRow();
    expect(v.directory_subscription_status).toBe('active');
    expect(new Date(String(v.directory_downgrade_at)).getTime()).toBeGreaterThan(Date.now());
    const sub = await stripe.subscriptions.retrieve(subId);
    expect(Boolean(sub.cancel_at) || sub.cancel_at_period_end).toBe(true);
  });
});

describe('a paying venue changes its plan', () => {
  // Runs after the describe above: the same venue, active again via "keep my plan".
  const owner = new Browser();

  beforeAll(async () => {
    await owner.signIn(VENUE.email);
  });

  it('“keep my plan” after cancelling undoes the cancellation', async () => {
    const res = await owner.fetch('/api/venue-billing/keep-plan', { method: 'POST' });
    expect(res.status, await res.clone().text()).toBe(200);
    const v = await venueRow();
    expect(v.directory_downgrade_at).toBeNull();
    const sub = await stripe.subscriptions.retrieve(String(v.stripe_subscription_id));
    expect(Boolean(sub.cancel_at) || sub.cancel_at_period_end).toBe(false);
  });

  it('adding the AI Concierge add-on bills it on the subscription; removing it stops that', async () => {
    const prices = (await (await fetch(`${env.base}/api/admin/addon-prices`, { headers: { 'x-staging-key': env.stagingKey } })).json()) as { concierge_cents: number };
    const total = async () => {
      const sub = await stripe.subscriptions.retrieve(String((await venueRow()).stripe_subscription_id));
      return sub.items.data.reduce((s, it) => s + (it.price.unit_amount ?? 0) * (it.quantity ?? 1), 0);
    };
    const add = await owner.fetch('/api/venue-billing/addons', { method: 'POST', json: { concierge: true } });
    expect(add.status, await add.clone().text()).toBe(200);
    expect(await total()).toBe(9700 + prices.concierge_cents);
    const remove = await owner.fetch('/api/venue-billing/addons', { method: 'POST', json: { concierge: false } });
    expect(remove.status, await remove.clone().text()).toBe(200);
    expect(await total()).toBe(9700);
  });

  it('a cancelled term ends and the venue moves to Free', async () => {
    expect((await owner.fetch('/api/venue-billing/cancel', { method: 'POST' })).status).toBe(200);
    // The term the venue paid for has run out (two days ago, past Stripe's grace).
    await db.from('venues').update({ directory_downgrade_at: new Date(Date.now() - 2 * DAY).toISOString() }).eq('id', VENUE.id);
    const job = await fetch(`${env.base}/api/cron/trial-sweep`, { headers: { 'x-staging-key': env.stagingKey, authorization: `Bearer ${process.env.MARKETING_CRON_SECRET}` } });
    expect(job.status, await job.clone().text()).toBe(200);
    const v = await venueRow();
    expect(v.directory_downgrade_at).toBeNull();
    expect(v.directory_subscription_status).not.toBe('active');
  });
});

describe('a trial without a card', () => {
  const venue = { id: randomUUID(), email: `nocard.${runId}@example.com` };
  const run = () => fetch(`${env.base}/api/cron/trial-sweep`, { headers: { 'x-staging-key': env.stagingKey, authorization: `Bearer ${process.env.MARKETING_CRON_SECRET}` } });
  const endsIn = (ms: number) => db.from('venues').update({ directory_trial_ends_at: new Date(Date.now() + ms).toISOString() }).eq('id', venue.id);

  beforeAll(async () => {
    const { data: plan } = await db.from('directory_plans').select('id').eq('slug', 'bride-booking-system').single();
    const now = Date.now();
    const { error } = await db.from('venues').insert({
      id: venue.id, name: `No Card ${runId}`, slug: `no-card-${runId}`, email: venue.email, notification_email: venue.email,
      password_hash: await bcrypt.hash(env.password, 10), setup_completed: true, onboarding_status: 'registered',
      onboarding_completed_at: new Date(now).toISOString(), directory_plan_id: plan!.id, directory_subscription_status: 'trialing',
      directory_trial_started_at: new Date(now - 12 * DAY).toISOString(), directory_trial_ends_at: new Date(now + 2 * DAY).toISOString(),
      directory_card_on_file: false, timezone: 'America/New_York', is_published: true, is_demo: false,
    });
    if (error) throw new Error(error.message);
  });

  it('gets a heads-up a few days out, a notice when it ends, then moves to Free after the grace period', async () => {
    // Each wait takes only its own email: the heads-up can't stand in for the notice.
    let since = new Date().toISOString();
    expect((await run()).status).toBe(200);
    await waitForEmail({ to: venue.email, since }, (e) => e.subject.startsWith('Your free trial ends '));

    since = new Date().toISOString();
    await endsIn(-60 * 60_000);
    expect((await run()).status).toBe(200);
    await waitForEmail({ to: venue.email, since }, (e) => e.subject === 'Your free trial ended');

    await endsIn(-8 * DAY);
    expect((await run()).status).toBe(200);
    const { data } = await db.from('venues').select('directory_subscription_status').eq('id', venue.id).single();
    expect(data!.directory_subscription_status).not.toBe('trialing');
  });
});
