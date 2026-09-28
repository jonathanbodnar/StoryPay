'use client';

/**
 * StripeTrialCardForm — the Stripe card form embedded in the onboarding modal
 * (no redirect). Confirms a SetupIntent (saves the card, charges nothing), then
 * POSTs to /api/venue-billing/stripe/confirm-card, which starts the 14-day
 * trial subscription (Pro) or just keeps the card on file (Free).
 */

import { useMemo, useState } from 'react';
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Loader2 } from 'lucide-react';

const stripePromises = new Map<string, Promise<StripeJs | null>>();
function stripeFor(publishableKey: string): Promise<StripeJs | null> {
  let p = stripePromises.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripePromises.set(publishableKey, p);
  }
  return p;
}

interface Props {
  clientSecret: string;
  publishableKey: string;
  plan: 'free' | 'pro';
  onSuccess: () => void;
  onError: (msg: string) => void;
}

export default function StripeTrialCardForm({ clientSecret, publishableKey, plan, onSuccess, onError }: Props) {
  const stripePromise = useMemo(() => stripeFor(publishableKey), [publishableKey]);
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: { colorPrimary: '#1b1b1b', colorText: '#1a202c', borderRadius: '8px', fontSizeBase: '16px' },
        },
      }}
    >
      <CardForm plan={plan} onSuccess={onSuccess} onError={onError} />
    </Elements>
  );
}

function CardForm({ plan, onSuccess, onError }: Omit<Props, 'clientSecret' | 'publishableKey'>) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    onError('');
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: window.location.href },
    });
    if (error) {
      onError(error.message || 'Your card could not be verified. Please try again.');
      setSubmitting(false);
      return;
    }
    if (!setupIntent || setupIntent.status !== 'succeeded') {
      onError('Your card needs another step. Please try again.');
      setSubmitting(false);
      return;
    }
    setUnlocking(true);
    try {
      const res = await fetch('/api/venue-billing/stripe/confirm-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupIntentId: setupIntent.id, plan }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to unlock your dashboard');
      onSuccess();
    } catch (err) {
      setUnlocking(false);
      setSubmitting(false);
      onError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }

  if (unlocking) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Loader2 size={24} className="animate-spin text-gray-500" />
        <p className="text-sm font-semibold text-gray-900">Unlocking your dashboard…</p>
        <p className="max-w-xs text-xs text-gray-500">Please don&apos;t close or refresh this window.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {!ready && (
        <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading secure payment form…</span>
        </div>
      )}
      <div className={ready ? '' : 'hidden'}>
        <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs' }} />
      </div>
      {ready && (
        <button
          type="submit"
          disabled={!stripe || submitting}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1b1b1b] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {plan === 'free' ? 'Verify my venue & go live' : 'Start my 14-day free trial'}
        </button>
      )}
    </form>
  );
}
