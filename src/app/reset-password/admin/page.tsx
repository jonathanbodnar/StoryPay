'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, CheckCircle2, MailCheck } from 'lucide-react';
import PasswordStrengthBar from '@/components/PasswordStrengthBar';
import { checkPassword } from '@/lib/password-policy';

function Logo() {
  return (
    <div className="flex justify-center mb-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/storyvenue-dark-logo.png" alt="StoryVenue" className="h-8 object-contain" />
    </div>
  );
}

/** Step 1 — request a reset link by email. */
function RequestForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/admin/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      // Always show the same confirmation — no account enumeration.
      setSent(true);
    } catch {
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <MailCheck size={40} className="mx-auto text-green-500 mb-4" />
        <h2 className="text-lg font-bold text-gray-900 mb-2">Check your email</h2>
        <p className="text-sm text-gray-500">
          If an admin account exists for <strong>{email.trim()}</strong>, we&apos;ve sent a
          password-reset link. It expires in 1 hour.
        </p>
        <div className="mt-6">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
            ← Back to Admin Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Reset your password</h2>
      <p className="text-sm text-gray-500 mb-6">
        Enter the email for your StoryVenue admin account and we&apos;ll send you a reset link.
      </p>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@storyvenue.com"
            required
            autoFocus
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !email.trim()}
          className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-85 inline-flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ backgroundColor: '#1b1b1b' }}
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <div className="mt-5 text-center">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
          ← Back to Admin Login
        </Link>
      </div>
    </>
  );
}

/** Step 2 — set a new password using the token from the email link. */
function SetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const pwCheck = checkPassword(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!pwCheck.valid) { setError(pwCheck.message); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth/reset', {
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
      setTimeout(() => router.push('/admin'), 1800);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 size={40} className="mx-auto text-green-500 mb-4" />
        <h2 className="text-lg font-bold text-gray-900 mb-2">Password updated!</h2>
        <p className="text-sm text-gray-500">Signing you in…</p>
      </div>
    );
  }

  return (
    <>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Set a new password</h2>
      <p className="text-sm text-gray-500 mb-6">Choose a new password for your StoryVenue admin account.</p>

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
          <PasswordStrengthBar password={password} className="mt-2" />
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
          disabled={loading || !pwCheck.valid || !confirm}
          className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-85 inline-flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ backgroundColor: '#1b1b1b' }}
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          {loading ? 'Updating…' : 'Update Password'}
        </button>
      </form>

      <div className="mt-5 text-center">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
          ← Back to Admin Login
        </Link>
      </div>
    </>
  );
}

function AdminResetInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <Logo />
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {token ? <SetPasswordForm token={token} /> : <RequestForm />}
        </div>
      </div>
    </div>
  );
}

export default function AdminResetPasswordPage() {
  return (
    <Suspense>
      <AdminResetInner />
    </Suspense>
  );
}
