'use client';

/**
 * The couple's payment form for a venue on Stripe Connect: Stripe's Payment
 * Element on the venue's own Stripe account (card, Apple Pay / Google Pay,
 * and bank transfer when the venue accepts it). The payment is confirmed on
 * the server (/api/proposals/public/[token]/stripe-pay) so StoryVenue's fee
 * matches the method the couple picks.
 */

import { useMemo, useState } from 'react';
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

export interface StripeProposalIntent {
  provider: 'stripe';
  publishableKey: string;
  stripeAccount: string;
  amountCents: number;
  paymentType: string;
  paymentMethods: string[];
  savePaymentMethod: boolean;
  customerName: string;
  customerEmail: string;
}

const stripePromises = new Map<string, Promise<StripeJs | null>>();
function stripeFor(publishableKey: string, stripeAccount: string): Promise<StripeJs | null> {
  const key = `${publishableKey}:${stripeAccount}`;
  let p = stripePromises.get(key);
  if (!p) {
    p = loadStripe(publishableKey, { stripeAccount });
    stripePromises.set(key, p);
  }
  return p;
}

const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

interface Props {
  token: string;
  intent: StripeProposalIntent;
  brandColor: string;
  onSuccess: () => void;
  onProcessing: () => void;
}

export default function StripeProposalPaymentForm({ token, intent, brandColor, onSuccess, onProcessing }: Props) {
  const stripePromise = useMemo(() => stripeFor(intent.publishableKey, intent.stripeAccount), [intent.publishableKey, intent.stripeAccount]);
  return (
    <Elements
      stripe={stripePromise}
      options={{
        mode: 'payment',
        amount: intent.amountCents,
        currency: 'usd',
        paymentMethodTypes: intent.paymentMethods,
        ...(intent.savePaymentMethod ? { setupFutureUsage: 'off_session' as const } : {}),
        appearance: {
          theme: 'stripe',
          variables: { colorPrimary: brandColor || '#1b1b1b', colorText: '#1a202c', borderRadius: '8px', fontSizeBase: '16px' },
        },
      }}
    >
      <PayForm token={token} intent={intent} brandColor={brandColor} onSuccess={onSuccess} onProcessing={onProcessing} />
    </Elements>
  );
}

function PayForm({ token, intent, brandColor, onSuccess, onProcessing }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, string>) {
    const res = await fetch(`/api/proposals/public/${token}/stripe-pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({ status: 'failed', error: 'Payment failed. Please try again.' }))) as {
      status?: 'succeeded' | 'processing' | 'requires_action' | 'failed';
      clientSecret?: string;
      paymentIntentId?: string;
      error?: string;
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) throw new Error(submitError.message || 'Please check your payment details.');

      const { error: tokenError, confirmationToken } = await stripe.createConfirmationToken({
        elements,
        params: { return_url: window.location.href },
      });
      if (tokenError || !confirmationToken) throw new Error(tokenError?.message || 'Please check your payment details.');

      let result = await post({ confirmationTokenId: confirmationToken.id });
      if (result.status === 'requires_action' && result.clientSecret) {
        const { error: actionError } = await stripe.handleNextAction({ clientSecret: result.clientSecret });
        if (actionError) throw new Error(actionError.message || 'Your bank didn’t authorize this payment.');
        result = await post({ paymentIntentId: result.paymentIntentId ?? '' });
      }

      if (result.status === 'succeeded') return onSuccess();
      if (result.status === 'processing') return onProcessing();
      throw new Error(result.error || 'Your payment couldn’t be completed. Please try again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your payment couldn’t be completed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="relative">
      {!ready && (
        <div className="flex items-center justify-center gap-2 py-10 text-gray-400">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-sm">Loading secure payment form…</span>
        </div>
      )}
      <div className={ready ? '' : 'hidden'}>
        <PaymentElement
          onReady={() => setReady(true)}
          options={{
            layout: 'tabs',
            defaultValues: { billingDetails: { name: intent.customerName, email: intent.customerEmail } },
          }}
        />
      </div>
      {error && <div className="mt-3 rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {ready && (
        <button
          type="submit"
          disabled={!stripe || busy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-semibold text-white transition disabled:opacity-60"
          style={{ backgroundColor: brandColor || '#1b1b1b' }}
        >
          {busy && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {busy ? 'Processing payment…' : `Pay ${usd(intent.amountCents)}`}
        </button>
      )}
      {ready && <p className="mt-2 text-center text-xs text-gray-400">Payments are processed securely by Stripe</p>}
    </form>
  );
}
