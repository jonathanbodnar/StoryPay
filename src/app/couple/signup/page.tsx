'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function CoupleSignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/couple/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          display_name: displayName.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Sign up failed');
        return;
      }
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-heading text-2xl text-gray-900">Check your email</h1>
        <p className="mt-3 text-sm text-gray-600">
          We sent a confirmation link to <strong>{email}</strong>. After you confirm, you can log in to save venues and
          edit your profile.
        </p>
        <Link href="/couple/login" className="mt-6 inline-block text-sm font-medium text-gray-900 underline">
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="font-heading text-2xl text-gray-900">Create a couple account</h1>
      <p className="mt-2 text-sm text-gray-500">Wish lists, saved venues, and your wedding profile.</p>

      <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        )}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Your name</label>
          <input
            type="text"
            className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Alex & Jordan"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Email</label>
          <input
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Password</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-400">At least 8 characters.</p>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1b1b1b] py-3 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Sign up
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Already have an account?{' '}
        <Link href="/couple/login" className="font-medium text-gray-900 underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
