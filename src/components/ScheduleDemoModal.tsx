'use client';

/**
 * ScheduleDemoModal — pops up when a venue clicks a locked, higher-tier feature
 * (e.g. AI Concierge on Free / Bride Booking System). Embeds our booking
 * calendar so they can schedule a demo without leaving the app.
 *
 * Calendar source: NEXT_PUBLIC_DEMO_CALENDAR_URL (an embeddable scheduler such
 * as Calendly/Cal.com). Falls back to a button linking to NEXT_PUBLIC_DEMO_URL
 * when no embeddable URL is configured.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CalendarClock, Sparkles, ArrowRight } from 'lucide-react';

const CALENDAR_URL = process.env.NEXT_PUBLIC_DEMO_CALENDAR_URL || '';
const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL || '';

export default function ScheduleDemoModal({
  open,
  onClose,
  featureName = 'AI Concierge',
  blurb = 'See how AI Concierge follows up with quiet leads over SMS until they reply, so you book more brides without lifting a finger.',
}: {
  open: boolean;
  onClose: () => void;
  featureName?: string;
  blurb?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full bg-white/80 p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="border-b border-gray-100 px-7 pb-5 pt-7 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg">
            <Sparkles size={20} />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-500">{featureName} · All-Inclusive</p>
          <h2 className="mt-1 text-xl font-semibold text-gray-900">Book a quick demo</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-gray-500">{blurb}</p>
        </div>

        {CALENDAR_URL ? (
          <div className="min-h-[420px] flex-1 overflow-y-auto bg-gray-50">
            <iframe
              src={CALENDAR_URL}
              title="Schedule a demo"
              className="h-[520px] w-full border-0"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 px-7 py-12 text-center">
            <CalendarClock size={28} className="text-gray-400" />
            <p className="max-w-sm text-sm text-gray-600">
              Pick a time that works and we&apos;ll walk you through {featureName} live.
            </p>
            {DEMO_URL ? (
              <a
                href={DEMO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
              >
                <CalendarClock size={14} /> Schedule a demo <ArrowRight size={14} />
              </a>
            ) : (
              <a
                href="mailto:hello@storyvenue.com?subject=AI%20Concierge%20demo"
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
              >
                <CalendarClock size={14} /> Request a demo <ArrowRight size={14} />
              </a>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
