'use client';

import { useEffect, useState } from 'react';

export default function GHLFallback() {
  const [checking, setChecking] = useState(true);
  const [locationId, setLocationId] = useState('');

  useEffect(() => {
    if (document.referrer) {
      const match = document.referrer.match(/\/location\/([a-zA-Z0-9]+)/);
      if (match) {
        window.location.href = `/api/auth/ghl/${match[1]}`;
        return;
      }
    }
    setChecking(false);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = locationId.trim();
    if (!trimmed) return;
    window.location.href = `/api/auth/ghl/${trimmed}`;
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Signing you in…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl p-10 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-brand-900/5 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-brand-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
        </div>
        <h1 className="font-heading text-2xl text-gray-900 mb-2">Welcome to StoryPay</h1>
        <p className="text-gray-500 text-sm mb-6">
          Enter your Location ID to access your dashboard.
        </p>

        <form onSubmit={handleSubmit} className="text-left">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Location ID
          </label>
          <input
            type="text"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            placeholder="e.g. abc123XYZ..."
            className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-brand-900 focus:border-brand-900 outline-none mb-4"
            required
            autoFocus
          />
          <button
            type="submit"
            className="w-full bg-brand-700 hover:bg-brand-700 text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            Continue
          </button>
        </form>

        <p className="mt-6 text-xs text-gray-400">
          Your Location ID can be found in your dashboard URL after &quot;/location/&quot;
        </p>
      </div>
    </div>
  );
}
