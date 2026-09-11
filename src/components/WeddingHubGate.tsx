'use client';

import { useEffect, useState } from 'react';
import { Heart, Lock } from 'lucide-react';

/**
 * Temporary beta password gate for the Wedding Hub while the feature is still
 * being iterated on. Children are not mounted (and their data fetches don't
 * fire) until the correct code is entered. Unlock is remembered per-browser.
 *
 * NOTE: This is a soft gate — the code lives client-side and only deters casual
 * access during the beta. It is not a security boundary; real access control is
 * still enforced by auth + the plan/flag gating around the Wedding Hub. Once the
 * feature is fully released, remove this wrapper.
 */
const GATE_CODE = '7111';
const STORAGE_KEY = 'wedding_hub_beta_unlocked';

export default function WeddingHubGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setUnlocked(true);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (value.trim() === GATE_CODE) {
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        /* ignore */
      }
      setUnlocked(true);
    } else {
      setError(true);
      setValue('');
    }
  }

  // Avoid a flash of the form before we've checked storage.
  if (!ready) return null;
  if (unlocked) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50">
          <Heart className="h-6 w-6 text-rose-500" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-gray-900">Wedding Hub — Beta</h1>
        <p className="mt-1 text-sm text-gray-500">
          Wedding Hub is in private beta. Enter your access code to continue.
        </p>

        <div className="mt-5">
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(false);
              }}
              placeholder="Access code"
              className={`w-full rounded-xl border bg-white py-2.5 pl-9 pr-3 text-center text-sm tracking-widest text-gray-900 focus:outline-none focus:ring-1 ${
                error
                  ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
                  : 'border-gray-200 focus:border-gray-400 focus:ring-gray-200'
              }`}
            />
          </div>
          {error && <p className="mt-2 text-xs text-red-600">That code isn&rsquo;t right. Try again.</p>}
        </div>

        <button
          type="submit"
          className="mt-4 w-full rounded-xl bg-[#1b1b1b] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85"
        >
          Unlock Wedding Hub
        </button>
      </form>
    </div>
  );
}
