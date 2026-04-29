'use client';

/**
 * PaymentGate
 *
 * Wraps any payment page/section.
 * While the venue is not an approved StoryPay merchant:
 *   - The children are replaced by a full-page locked state.
 *   - The user can open the onboarding modal directly from here.
 */
import { useEffect, useState } from 'react';
import { Zap, Lock } from 'lucide-react';

export default function PaymentGate({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<boolean | null>(null); // null = checking

  useEffect(() => {
    fetch('/api/lunarpay/active', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { active?: boolean } | null) => setActive(d?.active ?? false))
      .catch(() => setActive(false));
  }, []);

  // Still loading — render children transparently; the page is interactive once we know
  if (active === null) return <>{children}</>;

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
        You need an approved StoryPay merchant account before you can send proposals or process
        payments. The application takes just a few minutes.
      </p>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('storypay:open-onboarding'))}
        className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
      >
        <Zap size={15} />
        Apply for StoryPay
      </button>
    </div>
  );
}
