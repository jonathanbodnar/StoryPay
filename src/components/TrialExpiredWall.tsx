'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Lock, Loader2, Sparkles, ArrowDownToLine } from 'lucide-react';
import { trackClient } from '@/lib/analytics-client';

/**
 * Full-page blocking wall shown when a venue's 14-day Venue Pro trial has
 * ended and no card is on file. The venue must either:
 *   • Add a card → converts to a paid Venue Pro subscription (billed today), or
 *   • Downgrade to Free → no subscription, Free-plan access only.
 *
 * Rendered server-side from dashboard/layout.tsx INSTEAD of the dashboard, so
 * there is nothing to dismiss it to without taking one of the two actions.
 */
export default function TrialExpiredWall({ venueName }: { venueName: string }) {
  const [busy, setBusy] = useState<'add_card' | 'downgrade' | null>(null);
  const [error, setError] = useState('');
  // Downsell: the first "Downgrade" click shows a save offer instead of
  // immediately dropping the booking system.
  const [confirmDowngrade, setConfirmDowngrade] = useState(false);

  // Analytics: conversion blocker — venue hit the expired-trial paywall.
  useEffect(() => { trackClient('trial_wall_hit', { label: 'Trial expired wall' }); }, []);

  async function addCard() {
    setBusy('add_card');
    setError('');
    trackClient('upgrade_started', { label: 'Add card (trial wall)' });
    try {
      const res = await fetch('/api/venue-billing/start-paid', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start checkout. Please try again.');
      }
      window.location.href = data.url as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setBusy(null);
    }
  }

  async function downgrade() {
    setBusy('downgrade');
    setError('');
    try {
      const res = await fetch('/api/venue-billing/downgrade-free', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Could not downgrade. Please try again.');
      }
      window.location.href = '/dashboard';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-[#1b1b1b] px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl">
        <div className="mb-6 flex justify-center">
          <Image src="/storyvenue-logo-dark.png" alt="StoryVenue" width={132} height={33} priority />
        </div>

        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            <Lock size={12} /> Trial ended
          </span>
          <h1 className="mt-4 text-2xl font-semibold text-gray-900">
            Your free trial has ended
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            {venueName ? <><strong className="text-gray-700">{venueName}</strong> — y</> : 'Y'}our
            14-day Venue Pro trial is over. Add a card to keep full access, or
            switch to the Free plan to continue with limited features.
          </p>
        </div>

        {error ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {confirmDowngrade ? (
          <div className="mt-7">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="font-semibold">Switch to Free and you turn off what books brides:</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[13px]">
                <li>Instant pricing guide auto-sent to every lead</li>
                <li>Speed-to-lead follow-up that replies in seconds</li>
              </ul>
              <p className="mt-1.5 text-[13px]">Your listing and payment processing stay on. You can turn it back on anytime.</p>
            </div>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={addCard}
                disabled={disabled}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1b1b1b] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
              >
                {busy === 'add_card' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Keep my Bride Booking System™
              </button>
              <button
                type="button"
                onClick={downgrade}
                disabled={disabled}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-60"
              >
                {busy === 'downgrade' ? <Loader2 size={16} className="animate-spin" /> : <ArrowDownToLine size={16} />}
                Switch to Free anyway
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-7 space-y-3">
            <button
              type="button"
              onClick={addCard}
              disabled={disabled}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1b1b1b] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
            >
              {busy === 'add_card' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Add a card &amp; keep Venue Pro
            </button>

            <button
              type="button"
              onClick={() => setConfirmDowngrade(true)}
              disabled={disabled}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
            >
              <ArrowDownToLine size={16} />
              Downgrade to Free
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          You can upgrade back to Venue Pro anytime from your billing settings.
        </p>
      </div>
    </div>
  );
}
