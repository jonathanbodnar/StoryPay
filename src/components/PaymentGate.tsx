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
 * of pushing the venue into an application flow that is switched off. Approved
 * merchants are never affected.
 */
import { useEffect, useState } from 'react';
import { Zap, Lock, Sparkles } from 'lucide-react';

export default function PaymentGate({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<boolean | null>(null); // null = checking
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    fetch('/api/lunarpay/active', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { active?: boolean; paused?: boolean } | null) => {
        setActive(d?.active ?? false);
        setPaused(d?.paused === true);
      })
      .catch(() => setActive(false));
  }, []);

  // Still loading — render children transparently; the page is interactive once we know
  if (active === null) return <>{children}</>;

  // Paused wins over everything except exempt venues: even an approved merchant
  // sees the notice while the pause is on. Checked before `active` on purpose.
  if (paused) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 ring-1 ring-indigo-100">
          <Sparkles size={28} className="text-indigo-500" />
        </div>
        <span className="mb-3 inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
          Coming soon
        </span>
        <h2 className="mb-2 text-xl font-bold text-gray-900">StoryPay is getting a big update</h2>
        <p className="mb-6 max-w-md text-sm leading-relaxed text-gray-500">
          Stay tuned! We&apos;ve paused new payment signups while we finish a newer, better payments
          experience. You can keep using everything else, and payments will be back shortly. If you&apos;d
          like a walkthrough in the meantime, schedule a demo and we&apos;ll show you what&apos;s coming.
        </p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('storypay:open-onboarding'))}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          <Sparkles size={15} />
          See what&apos;s coming
        </button>
      </div>
    );
  }

  // Approved — full access
  if (active) return <>{children}</>;

  // Not approved — show locked state
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 ring-1 ring-red-100">
        <Lock size={28} className="text-red-500" />
      </div>
      <h2 className="mb-2 text-xl font-bold text-gray-900">Payment processing required</h2>
      <p className="mb-6 max-w-sm text-sm text-gray-500">
        You need an approved StoryPay™ merchant account before you can send proposals or process
        payments. The application takes just a few minutes — and it&apos;s free for venue owners.
      </p>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('storypay:open-onboarding'))}
        className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
      >
        <Zap size={15} />
        Signup for StoryPay™
      </button>
    </div>
  );
}
