'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, X, ArrowRight, Sparkles, CalendarClock } from 'lucide-react';
import DashboardBookingModal from '@/components/DashboardBookingModal';

/**
 * Inline lock modal for plan-gated features (SMS, AI Concierge) that live
 * inside a page rather than a whole nav route. Clicking a locked control
 * opens this — the CTA always routes to the billing page to upgrade, with a
 * secondary "Schedule a demo" option.
 */

export type LockFeature = 'sms' | 'concierge';

interface LockCopy {
  label: string;
  headline: string;
  outcome: string;
  note: string;
}

const COPY: Record<LockFeature, LockCopy> = {
  sms: {
    label: 'SMS messaging',
    headline: 'Text couples the moment they inquire',
    outcome:
      'Two-way SMS reaches couples where they actually reply — 98% of texts get read within minutes. SMS requires A2P carrier registration, which is included in our All-Inclusive plans.',
    note: 'Included in All-Inclusive plans.',
  },
  concierge: {
    label: 'AI Venue Concierge',
    headline: 'AI follows up so you don\u2019t have to',
    outcome:
      'Personalized follow-up sent on your behalf on a 1\u20132 day cadence for up to 60 days. The AI stops the moment a couple replies, then hands the conversation to you.',
    note: 'Available as an add-on or included in the All-Inclusive Concierge plan.',
  },
};

function LockBody({ feature, onNavigate }: { feature: LockFeature; onNavigate?: () => void }) {
  const copy = COPY[feature];
  const [demoOpen, setDemoOpen] = useState(false);

  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg">
        <Lock size={22} />
      </div>

      <p className="text-xs font-semibold uppercase tracking-widest text-violet-500 mb-1">
        {copy.label}
      </p>

      <h2 className="font-heading text-2xl text-gray-900">{copy.headline}</h2>

      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-gray-600">
        {copy.outcome}
      </p>

      <p className="mx-auto mt-2 max-w-sm text-sm text-violet-600 font-medium">{copy.note}</p>

      <div className="mt-6 flex flex-col items-center justify-center gap-3">
        <Link
          href="/dashboard/directory-billing"
          onClick={onNavigate}
          className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          <Sparkles size={14} />
          View plans &amp; upgrade
          <ArrowRight size={14} />
        </Link>
        <button
          type="button"
          onClick={() => setDemoOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          <CalendarClock size={14} />
          Schedule a demo
        </button>
      </div>

      <DashboardBookingModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}

export default function FeatureLockModal({
  open,
  onClose,
  feature,
}: {
  open: boolean;
  onClose: () => void;
  feature: LockFeature;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <LockBody feature={feature} onNavigate={onClose} />
      </div>
    </div>,
    document.body,
  );
}
