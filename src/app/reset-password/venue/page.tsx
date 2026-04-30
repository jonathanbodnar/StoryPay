'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) setError('No reset token found. Please request a new password reset link.');
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/venue/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Reset failed. Please try again.');
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/dashboard'), 2000);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Image
            src="/storyvenue-logo-dark.png"
            alt="StoryVenue"
            width={160}
            height={40}
            className="mx-auto object-contain"
            priority
          />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {done ? (
            <div className="text-center">
              <CheckCircle2 size={40} className="mx-auto text-green-500 mb-4" />
              <h2 className="text-lg font-bold text-gray-900 mb-2">Password updated!</h2>
              <p className="text-sm text-gray-500">Redirecting you to the dashboard…</p>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Set a new password</h2>
              <p className="text-sm text-gray-500 mb-6">Enter a new password for your StoryVenue account.</p>

              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      required
                      className="w-full rounded-lg border border-gray-300 px-4 py-2.5 pr-10 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter your password"
                    required
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
                  />
                </div>

                {error && (
                  <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !token}
                  className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-85 inline-flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#1b1b1b' }}
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {loading ? 'Updating…' : 'Update Password'}
                </button>
              </form>

              <div className="mt-5 text-center">
                <a href="/login" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
                  ← Back to Sign In
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VenueResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
