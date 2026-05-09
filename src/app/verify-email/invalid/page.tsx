'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, Loader2, MailCheck } from 'lucide-react';

export default function VerifyEmailInvalid() {
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setResending(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
      if (!res.ok) throw new Error('Could not resend the verification email.');
      setResent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend.');
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-10 text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mb-6">
          <AlertTriangle className="w-7 h-7 text-amber-600" />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-3">
          This verification link is no longer valid
        </h1>
        <p className="text-gray-600 leading-relaxed mb-8">
          Verification links expire after 24 hours and can only be used once.
          Sign in to your account and click the button below to send a fresh link.
        </p>

        {resent ? (
          <div className="flex items-center justify-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 mb-6">
            <MailCheck className="w-5 h-5" />
            <span className="text-sm font-medium">A new verification email is on the way.</span>
          </div>
        ) : (
          <button
            onClick={resend}
            disabled={resending}
            className="w-full bg-[#1b1b1b] text-white font-semibold rounded-lg px-6 py-3 hover:bg-black transition disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {resending && <Loader2 className="w-4 h-4 animate-spin" />}
            {resending ? 'Sending…' : 'Resend verification email'}
          </button>
        )}

        {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

        <p className="text-sm text-gray-500 mt-8">
          Or{' '}
          <Link href="/login" className="text-gray-900 underline hover:no-underline">
            sign in to your account
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
