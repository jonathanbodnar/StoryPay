'use client';

import { Sparkles } from 'lucide-react';

/**
 * The "StoryPay is getting a big update" notice.
 *
 * Shown instead of any StoryPay / Payments surface while the pause is on —
 * both by PaymentGate (page-level wrapper) and by DashboardShell (which gates
 * the whole Payments & proposals menu by path prefix, so every current and
 * future page under it is covered without needing its own wrapper).
 *
 * The button opens the full explainer modal via the same event the sidebar and
 * banner use, so there is one place that owns the StoryPay messaging.
 */
export default function StoryPayPausedNotice() {
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
        Stay tuned! We&apos;ve paused StoryPay while we finish a newer, better payments experience.
        This section will be back shortly. If you&apos;d like a walkthrough in the meantime, schedule
        a demo and we&apos;ll show you what&apos;s coming.
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
