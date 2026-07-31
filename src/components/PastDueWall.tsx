'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { AlertTriangle, CreditCard, Loader2, RefreshCw } from 'lucide-react';

/**
 * Full-page blocking wall shown when a venue's subscription charge has failed
 * (directory_subscription_status = 'past_due'). The venue must either:
 *   • Retry the charge on their saved card, or
 *   • Update their payment method (redirects to LunarPay hosted checkout).
 *
 * Rendered server-side from dashboard/layout.tsx INSTEAD of the dashboard —
 * there is nothing to dismiss it to without taking one of the two actions.
 */
export default function PastDueWall({
  venueName,
  cardLastFour,
}: {
  venueName: string;
  cardLastFour?: string | null;
}) {
  const [busy, setBusy] = useState<'retry' | 'update' | null>(null);
  const [error, setError] = useState('');
  const [retryOk, setRetryOk] = useState(false);

  useEffect(() => {
    // If retry succeeded, reload the page so the layout re-checks the status.
    if (retryOk) {
      window.location.reload();
    }
  }, [retryOk]);

  async function retryCharge() {
    setBusy('retry');
    setError('');
    try {
      const res = await fetch('/api/venue-billing/retry', { method: 'POST' });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Retry failed. Please try again.');
      setRetryOk(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setBusy(null);
    }
  }

  async function updateCard() {
    setBusy('update');
    setError('');
    try {
      const res = await fetch('/api/venue-billing/update-payment', { method: 'POST' });
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start card update. Please try again.');
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setBusy(null);
    }
  }

  const disabled = busy !== null || retryOk;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-[#1b1b1b] px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl">
        <div className="mb-6 flex justify-center">
          <Image src="/storyvenue-logo-dark.png" alt="StoryVenue" width={132} height={33} priority />
        </div>

        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
            <AlertTriangle size={12} /> Payment failed
          </span>
          <h1 className="mt-4 text-2xl font-semibold text-gray-900">
            Your payment didn&apos;t go through
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            {venueName ? (
              <><strong className="text-gray-700">{venueName}</strong> — w</>
            ) : 'W'}
            e weren&apos;t able to charge your card
            {cardLastFour ? (
              <> ending in <strong className="text-gray-700">••••{cardLastFour}</strong></>
            ) : null}
            . Retry the charge or update your payment method to restore full access.
          </p>
        </div>

        {error && (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        {retryOk ? (
          <div className="mt-6 flex flex-col items-center gap-2 text-center">
            <Loader2 size={22} className="animate-spin text-emerald-500" />
            <p className="text-sm font-semibold text-emerald-700">Payment succeeded — reloading your dashboard…</p>
          </div>
        ) : (
          <div className="mt-7 space-y-3">
            <button
              type="button"
              onClick={retryCharge}
              disabled={disabled}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1b1b1b] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
            >
              {busy === 'retry' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              {cardLastFour ? `Retry charge on card ••••${cardLastFour}` : 'Retry payment'}
            </button>

            <button
              type="button"
              onClick={updateCard}
              disabled={disabled}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
            >
              {busy === 'update' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <CreditCard size={16} />
              )}
              Use a different card
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          Need help? Email us at{' '}
          <a href="mailto:support@storyvenue.com" className="underline hover:text-gray-600">
            support@storyvenue.com
          </a>
        </p>
      </div>
    </div>
  );
}
