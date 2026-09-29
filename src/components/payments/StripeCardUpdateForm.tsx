'use client';

/**
 * The couple's new card (or bank account) for automatic installments on a
 * venue's Stripe account. Saved through a SetupIntent; nothing is charged here.
 */

import { useEffect, useMemo, useState } from 'react';
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

interface Setup {
  clientSecret: string;
  publishableKey: string;
  stripeAccount: string;
}

const cache = new Map<string, Promise<StripeJs | null>>();
function stripeFor(pk: string, account: string) {
  const key = `${pk}:${account}`;
  if (!cache.has(key)) cache.set(key, loadStripe(pk, { stripeAccount: account }));
  return cache.get(key)!;
}

export default function StripeCardUpdateForm({ token, onSuccess }: { token: string; onSuccess: () => void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/card-update/${token}/stripe-setup`, { method: 'POST' })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as Setup & { error?: string };
        if (!r.ok) throw new Error(d.error || 'Could not load the card form.');
        setSetup(d);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the card form.'));
  }, [token]);

  const stripePromise = useMemo(() => (setup ? stripeFor(setup.publishableKey, setup.stripeAccount) : null), [setup]);

  if (error) return <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!setup || !stripePromise) return <div className="py-10 text-center text-sm text-gray-400">Loading payment form…</div>;

  return (
    <Elements stripe={stripePromise} options={{ clientSecret: setup.clientSecret, appearance: { theme: 'stripe', variables: { borderRadius: '8px' } } }}>
      <Inner token={token} onSuccess={onSuccess} />
    </Elements>
  );
}

function Inner({ token, onSuccess }: { token: string; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: setupError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: window.location.href },
      });
      if (setupError) throw new Error(setupError.message || 'Your card couldn’t be saved.');
      if (!setupIntent || setupIntent.status !== 'succeeded') throw new Error('Your card needs another step. Please try again.');
      const res = await fetch(`/api/card-update/${token}/stripe-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupIntentId: setupIntent.id }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || 'Your card couldn’t be saved.');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your card couldn’t be saved.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <button
        type="submit"
        disabled={!stripe || busy}
        className="mt-5 w-full rounded-xl bg-[#1b1b1b] px-5 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Save card'}
      </button>
      <p className="mt-2 text-center text-xs text-gray-400">Your next payment will use this card. Nothing is charged now.</p>
    </form>
  );
}
