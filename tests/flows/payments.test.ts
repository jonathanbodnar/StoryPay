import Stripe from 'stripe';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, FLOW_VENUE, outbox, runId, signedInOwner, waitForEmail } from './helpers';

// Couples paying the venue on its own Stripe account, in Stripe TEST mode:
// test cards only, so no real money moves.
const key = (process.env.STRIPE_SECRET_KEY || '').trim();
if (!key.startsWith('sk_test_')) throw new Error('Payment flow tests need the test copy’s Stripe TEST key (sk_test_).');
const stripe = new Stripe(key);

const STORYVENUE_LOGO = 'storyvenue-logo-dark.png';
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

// Couples pay on the venue's own Stripe account. Its sign-up is Stripe's hosted
// form (behind a CAPTCHA), done once by a person for the flow venue:
// docs in scripts/staging/README.md. Until then these tests are skipped.
const connectStatus = (await (await (await signedInOwner()).fetch('/api/payments/stripe/connect')).json()) as { chargesEnabled?: boolean };
const venueReady = connectStatus.chargesEnabled === true;

describe.skipIf(!venueReady)('couples pay the venue', () => {
  let owner: Browser;
  let account = '';
  const couple = new Browser();

  async function signedProposal(name: string, price: number, payment: Record<string, unknown> = { paymentType: 'full', paymentConfig: {} }) {
    const email = `${name.split(' ')[0].toLowerCase()}.${runId}@example.com`;
    const res = await owner.fetch('/api/proposals', {
      method: 'POST',
      json: { overrideContent: '<p>Wedding at Flow Test Venue.</p>', customerName: name, customerEmail: email, price, ...payment },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const p = (await res.json()) as { id: string; public_token: string };
    const signed = await couple.fetch(`/api/proposals/public/${p.public_token}/sign`, {
      method: 'POST', json: { signatureData: { signature_0: SIGNATURE }, consentAccepted: true },
    });
    expect(signed.status).toBe(200);
    return { ...p, email };
  }

  // A payment plan keeps the card for later payments; the payment form says so
  // (setupFutureUsage) and Stripe refuses a token that doesn't match.
  async function pay(token: string, paymentMethod: string, opts: { saveCard?: boolean } = {}) {
    const ct = await stripe.testHelpers.confirmationTokens.create(
      { payment_method: paymentMethod, ...(opts.saveCard ? { setup_future_usage: 'off_session' as const } : {}) },
      { stripeAccount: account },
    );
    return couple.fetch(`/api/proposals/public/${token}/stripe-pay`, { method: 'POST', json: { confirmationTokenId: ct.id } });
  }

  async function waitForStatus(id: string, status: string, timeoutMs = 30_000) {
    const until = Date.now() + timeoutMs;
    let current = '';
    while (Date.now() < until) {
      current = ((await db.from('proposals').select('status').eq('id', id).single()).data?.status as string) ?? '';
      if (current === status) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
    expect(current).toBe(status);
  }

  beforeAll(async () => {
    owner = await signedInOwner();
    account = String((await db.from('venues').select('stripe_account_id').eq('id', FLOW_VENUE.id).single()).data?.stripe_account_id ?? '');
  });

  it('a couple pays in full by card: paid, receipt from the venue, owner alerted, fee collected', async () => {
    const since = new Date().toISOString();
    const p = await signedProposal('Casey Bennett', 120_000);
    const res = await pay(p.public_token, 'pm_card_visa');
    const body = (await res.json()) as { status: string; paymentIntentId: string };
    expect(body.status).toBe('succeeded');
    await waitForStatus(p.id, 'paid');

    const pi = await stripe.paymentIntents.retrieve(body.paymentIntentId, {}, { stripeAccount: account });
    expect(pi.amount).toBe(120_000);
    expect(pi.application_fee_amount ?? 0).toBeGreaterThan(0);
    expect(pi.metadata.storyvenue_proposal_id).toBe(p.id);

    const receipt = await waitForEmail({ to: p.email, since }, (e) => e.subject === `Payment receipt from ${FLOW_VENUE.name} — ${usd(120_000)}`);
    expect(receipt.html).not.toContain(STORYVENUE_LOGO);
    const alert = await waitForEmail({ to: FLOW_VENUE.email, since }, (e) => /Payment received/.test(e.subject) && e.subject.includes('Casey Bennett'));
    expect(alert.html).toContain(STORYVENUE_LOGO);

    const again = await pay(p.public_token, 'pm_card_visa');
    expect(((await again.json()) as { status: string }).status).toBe('failed');
  });

  it('a declined card is refused and nothing is marked paid', async () => {
    const since = new Date().toISOString();
    const p = await signedProposal('Taylor Brooks', 80_000);
    const res = await pay(p.public_token, 'pm_card_chargeDeclined');
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toMatch(/declined/i);
    expect(((await db.from('proposals').select('status').eq('id', p.id).single()).data?.status)).toBe('signed');
    expect((await outbox({ to: p.email, since })).filter((e) => /receipt/i.test(e.subject))).toHaveLength(0);
  });

  it('a payment plan: deposit now, the next payment charged automatically when due', async () => {
    const since = new Date().toISOString();
    const p = await signedProposal('Quinn Harper', 100_000, {
      paymentType: 'installment',
      paymentConfig: { installments: [{ amount: 40_000, date: today() }, { amount: 60_000, date: inDays(30) }] },
    });
    const res = await pay(p.public_token, 'pm_card_visa', { saveCard: true });
    expect(((await res.json()) as { status: string }).status).toBe('succeeded');
    await waitForEmail({ to: p.email, since }, (e) => e.subject === `Payment receipt from ${FLOW_VENUE.name} — ${usd(40_000)}`);

    const { data: rows } = await db.from('proposal_installments').select('id, installment_number, status, due_date').eq('proposal_id', p.id).order('installment_number');
    const second = rows?.find((r) => r.installment_number === 2);
    expect(second?.status).toBe('scheduled');
    expect(second?.due_date).toBe(inDays(30));

    // It comes due now (the job goes by next_attempt_at, as the app's own
    // reschedule sets it): the hourly job charges the saved card.
    await db.from('proposal_installments').update({ due_date: today(), next_attempt_at: new Date().toISOString() }).eq('id', second!.id);
    const job = await fetch(`${env.base}/api/cron/installments`, {
      headers: { 'x-staging-key': env.stagingKey, authorization: `Bearer ${process.env.MARKETING_CRON_SECRET}` },
    });
    expect(job.status).toBe(200);
    await waitForStatus(p.id, 'paid', 45_000);
    await waitForEmail({ to: p.email, since }, (e) => e.subject === `Payment receipt from ${FLOW_VENUE.name} — ${usd(60_000)}`, 45_000);
  });

  it('the owner refunds a payment', async () => {
    const since = new Date().toISOString();
    const p = await signedProposal('Skyler James', 50_000);
    const paid = (await (await pay(p.public_token, 'pm_card_visa')).json()) as { paymentIntentId: string };
    await waitForStatus(p.id, 'paid');
    const res = await owner.fetch('/api/transactions/refund', { method: 'POST', json: { proposalId: p.id, chargeId: paid.paymentIntentId } });
    expect(res.status, await res.clone().text()).toBe(200);
    const refunds = await stripe.refunds.list({ payment_intent: paid.paymentIntentId }, { stripeAccount: account });
    expect(refunds.data[0]?.amount).toBe(50_000);
    await waitForStatus(p.id, 'refunded', 45_000);
    await waitForEmail({ to: FLOW_VENUE.email, since }, (e) => e.subject === 'Refund issued to Skyler James');
    // One "Payment received" for the payment; the refund alert isn't another one.
    const received = (await outbox({ to: FLOW_VENUE.email, since })).filter((e) => /Payment received/.test(e.subject) && e.subject.includes('Skyler James'));
    expect(received).toHaveLength(1);
  });
});
