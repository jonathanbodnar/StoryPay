'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Loader2, Send, CheckCircle2, ArrowLeft } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/request-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      setSent(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Link href="/">
            <Image src="/storypay-logo-dark.png" alt="StoryPay" width={130} height={32} />
          </Link>
        </div>

        {sent ? (
          /* Success state */
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 mx-auto mb-4">
              <CheckCircle2 size={28} className="text-emerald-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Check your email</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              If an account is registered for <span className="font-medium text-gray-700">{email}</span>, we sent you a login link. Click it to access your dashboard.
            </p>
            <p className="text-xs text-gray-400 mt-4">
              Didn&apos;t get it? Check your spam folder or{' '}
              <button
                onClick={() => { setSent(false); setEmail(''); }}
                className="text-gray-600 underline hover:text-gray-900 transition-colors"
              >
                try again
              </button>.
            </p>
          </div>
        ) : (
          /* Form */
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <h1 className="text-xl font-bold text-gray-900 mb-1">Log in to StoryPay</h1>
            <p className="text-sm text-gray-500 mb-6">
              Enter your email and we&apos;ll send you a login link.
            </p>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@yourvenue.com"
                  required
                  autoFocus
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
                />
              </div>

              {error && (
                <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-all shadow-sm"
                style={{ backgroundColor: '#1b1b1b' }}
              >
                {loading
                  ? <><Loader2 size={15} className="animate-spin" /> Sending link...</>
                  : <><Send size={15} /> Send Login Link</>
                }
              </button>
            </form>

            <p className="text-xs text-gray-400 text-center mt-5">
              No password needed — we&apos;ll email you a secure link.
            </p>
          </div>
        )}

        <div className="text-center mt-5">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
            <ArrowLeft size={12} /> Back to homepage
          </Link>
        </div>
      </div>
    </div>
  );
}
