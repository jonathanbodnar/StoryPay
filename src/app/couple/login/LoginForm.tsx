'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getCoupleSupabase } from '@/lib/couple-browser';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/couple/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const supabase = getCoupleSupabase();
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signErr) {
        setError(signErr.message);
        return;
      }
      router.push(next.startsWith('/') ? next : '/couple/dashboard');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="font-heading text-2xl text-gray-900">Couple login</h1>
      <p className="mt-2 text-sm text-gray-500">
        Save venues to your wish list and keep your wedding profile in one place.
      </p>

      <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        )}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Email</label>
          <input
            type="email"
            autoComplete="email"
            required
            className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Password</label>
          <input
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1b1b1b] py-3 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Log in
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        No account?{' '}
        <Link href="/couple/signup" className="font-medium text-gray-900 underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
