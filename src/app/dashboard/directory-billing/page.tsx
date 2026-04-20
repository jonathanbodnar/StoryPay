'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, CreditCard } from 'lucide-react';

const BRAND = '#1b1b1b';

type VenueMe = {
  id: string;
  name: string;
  email: string | null;
  directory_plan_id: string | null;
  directory_subscription_status?: string;
  directory_subscription_external_id?: string | null;
  directory_plans?: { name: string; price_monthly_cents: number | null } | null;
};

export default function DirectoryBillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [venue, setVenue] = useState<VenueMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [verifyState, setVerifyState] = useState<'idle' | 'working' | 'ok' | 'bad'>('idle');
  const [verifyMsg, setVerifyMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/venues/me');
      if (!res.ok) {
        setErr('Could not load venue');
        return;
      }
      const data = (await res.json()) as VenueMe & {
        directory_plans?: { name: string; price_monthly_cents: number | null } | null;
      };
      const plan = data.directory_plans ?? null;
      setVenue({
        ...data,
        directory_plans: plan,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    if (!sessionId || !venue) return;
    let cancelled = false;
    async function verify() {
      setVerifyState('working');
      setVerifyMsg('');
      try {
        const res = await fetch('/api/directory-platform/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Verification failed');
        if (!cancelled) {
          setVerifyState('ok');
          setVerifyMsg('Subscription is active.');
          await load();
          router.replace('/dashboard/directory-billing');
        }
      } catch (e) {
        if (!cancelled) {
          setVerifyState('bad');
          setVerifyMsg(e instanceof Error ? e.message : 'Verification failed');
        }
      }
    }
    void verify();
    return () => {
      cancelled = true;
    };
  }, [searchParams, venue?.id, load, router]);

  async function startCheckout() {
    setCheckoutLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/directory-platform/checkout', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start checkout');
      if (data.url) window.location.href = data.url as string;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setCheckoutLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-gray-400">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (!venue?.directory_plan_id) {
    return (
      <div className="max-w-lg">
        <h1 className="font-heading text-xl text-gray-900">Plan &amp; billing</h1>
        <p className="mt-2 text-sm text-gray-600">No directory plan is assigned to your venue yet.</p>
      </div>
    );
  }

  const plan = venue.directory_plans;
  const priceCents = plan?.price_monthly_cents ?? 0;
  const status = venue.directory_subscription_status ?? 'none';
  const needsPay =
    priceCents > 0 && !['active', 'trialing', 'canceled'].includes(status);
  const active = status === 'active' || status === 'trialing' || (priceCents <= 0 && status !== 'canceled');

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="font-heading text-xl text-gray-900 flex items-center gap-2">
          <CreditCard size={22} className="text-gray-700" />
          Plan &amp; billing
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Pay StoryPay for your directory / listing plan. This is separate from your venue&apos;s LunarPay account for
          your couples and clients.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-2">
        <p className="text-sm font-medium text-gray-900">{plan?.name ?? 'Directory plan'}</p>
        {priceCents > 0 ? (
          <p className="text-sm text-gray-600">
            {(priceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} / month
          </p>
        ) : (
          <p className="text-sm text-gray-600">No monthly charge for this plan.</p>
        )}
        <p className="text-xs text-gray-500">
          Status:{' '}
          <span className="font-semibold text-gray-800">{status.replace(/_/g, ' ')}</span>
          {venue.directory_subscription_external_id ? (
            <span className="block mt-1 font-mono text-[10px] text-gray-400">
              Ref: {venue.directory_subscription_external_id}
            </span>
          ) : null}
        </p>
      </div>

      {verifyState === 'working' ? (
        <p className="text-sm text-gray-600 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Confirming payment…
        </p>
      ) : null}
      {verifyState === 'ok' ? <p className="text-sm text-emerald-700">{verifyMsg}</p> : null}
      {verifyState === 'bad' ? <p className="text-sm text-red-600">{verifyMsg}</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      {priceCents <= 0 ? (
        <p className="text-sm text-gray-600">You&apos;re on a complimentary or legacy plan — no card required.</p>
      ) : active && !needsPay ? (
        <p className="text-sm text-gray-600">Your subscription is in good standing.</p>
      ) : (
        <button
          type="button"
          disabled={checkoutLoading}
          onClick={() => void startCheckout()}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: BRAND }}
        >
          {checkoutLoading ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
          {needsPay || status === 'past_due' ? 'Pay with card & start subscription' : 'Update payment method'}
        </button>
      )}
    </div>
  );
}
