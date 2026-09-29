'use client';

/**
 * PaymentGate
 *
 * Wraps any payment page/section.
 * While the venue is not an approved StoryPay merchant:
 *   - The children are replaced by a full-page locked state.
 *   - The user can open the onboarding modal directly from here.
 *
 * When StoryPay signup is paused, the locked state explains the pause instead
 * of pushing the venue into an application flow that is switched off. Venues
 * that can use Stripe Connect get a "Connect with Stripe" button instead.
 * New LunarPay applications are closed, so any other venue that isn't set up
 * sees the same "moving to Stripe" notice.
 */
import { useEffect, useState } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import StoryPayPausedNotice from '@/components/StoryPayPausedNotice';
import { isNativeApp, openExternalBrowser } from '@/lib/platform';

export default function PaymentGate({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<boolean | null>(null); // null = checking
  const [paused, setPaused] = useState(false);
  const [stripe, setStripe] = useState<{ available: boolean; status: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/lunarpay/active', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { active?: boolean; paused?: boolean; stripe?: { available?: boolean; status?: string } } | null) => {
        setActive(d?.active ?? false);
        setPaused(d?.paused === true);
        setStripe({ available: d?.stripe?.available === true, status: d?.stripe?.status ?? 'none' });
      })
      .catch(() => setActive(false));
  }, []);

  async function connectStripe() {
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch('/api/payments/stripe/connect', { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !d.url) throw new Error(d.error || 'Could not open Stripe.');
      window.location.href = d.url;
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Could not open Stripe.');
      setConnecting(false);
    }
  }

  // Still loading — render children transparently; the page is interactive once we know
  if (active === null) return <>{children}</>;

  // Paused wins over everything except exempt venues: even an approved merchant
  // sees the notice while the pause is on. Checked before `active` on purpose.
  if (paused) return <StoryPayPausedNotice />;

  // Approved — full access
  if (active) return <>{children}</>;

  // Stripe Connect: send the venue to Stripe's signup (or to finish it).
  if (stripe?.available) {
    const reviewing = stripe.status === 'pending';
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 ring-1 ring-indigo-100">
          <Zap size={28} className="text-indigo-500" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-gray-900">
          {reviewing ? 'Stripe is reviewing your details' : 'Get paid online'}
        </h2>
        <p className="mb-6 max-w-sm text-sm text-gray-500">
          {reviewing
            ? 'Online payments turn on automatically as soon as Stripe approves your account, usually within minutes.'
            : 'Connect a Stripe account so couples can pay deposits and installments by card or bank transfer. It takes about 10 minutes.'}
        </p>
        {!reviewing && isNativeApp() ? (
          <button
            type="button"
            onClick={() => void openExternalBrowser('/dashboard/payments/settings')}
            className="flex items-center gap-2 rounded-xl bg-[#1b1b1b] px-6 py-3 text-sm font-semibold text-white shadow-sm"
          >
            Set up payments in your browser
          </button>
        ) : !reviewing && (
          <button
            type="button"
            onClick={() => void connectStripe()}
            disabled={connecting}
            className="flex items-center gap-2 rounded-xl bg-[#1b1b1b] px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-black transition-colors disabled:opacity-60"
          >
            {connecting ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
            {stripe.status === 'onboarding' ? 'Continue Stripe setup' : 'Connect with Stripe'}
          </button>
        )}
        {connectError && <p className="mt-3 text-sm text-red-600">{connectError}</p>}
      </div>
    );
  }

  // Not set up and Stripe isn't open to this venue yet: nothing to sign up
  // for until it is (new LunarPay applications are closed).
  return <StoryPayPausedNotice />;
}
