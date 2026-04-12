'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Loader2, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  // "Forgot password" flow
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState('');

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, rememberMe }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid email or password.');
        return;
      }
      // Redirect to dashboard
      window.location.href = data.redirect || '/dashboard';
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError('');
    try {
      const res = await fetch('/api/auth/request-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        setForgotError(d.error || 'Something went wrong.');
        return;
      }
      setForgotSent(true);
    } catch {
      setForgotError('Network error. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  }

  const INPUT = 'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 transition-colors';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Link href="/">
            <Image src="/storypay-logo-dark.png" alt="StoryPay" width={130} height={32} />
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-8">

          {forgotMode ? (
            /* ── Forgot / reset password ── */
            forgotSent ? (
              <div className="text-center">
                <div className="text-4xl mb-4">📬</div>
                <h2 className="text-lg font-bold text-gray-900 mb-2">Check your inbox</h2>
                <p className="text-sm text-gray-500 leading-relaxed">
                  If <span className="font-medium text-gray-700">{forgotEmail}</span> is linked to an account, we sent a login link. Click it to sign in.
                </p>
                <button
                  onClick={() => { setForgotMode(false); setForgotSent(false); setForgotEmail(''); }}
                  className="mt-5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                >
                  ← Back to Sign In
                </button>
              </div>
            ) : (
              <>
                <button onClick={() => setForgotMode(false)}
                  className="text-xs text-gray-400 hover:text-gray-600 mb-4 flex items-center gap-1 transition-colors">
                  ← Back
                </button>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Forgot your password?</h2>
                <p className="text-sm text-gray-500 mb-6">
                  Enter your email and we&apos;ll send you a sign-in link.
                </p>
                <form onSubmit={handleForgot} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                    <input type="email" required value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      placeholder="you@yourvenue.com" className={INPUT} autoFocus />
                  </div>
                  {forgotError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{forgotError}</p>}
                  <button type="submit" disabled={forgotLoading || !forgotEmail.trim()}
                    className="w-full flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed"
                    style={{ backgroundColor: '#1b1b1b' }}
                    onMouseEnter={e => { if (!forgotLoading && forgotEmail.trim()) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#333333'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1b1b1b'; }}>
                    {forgotLoading ? <Loader2 size={15} className="animate-spin" /> : null}
                    {forgotLoading ? 'Sending...' : 'Send Sign-In Link'}
                  </button>
                </form>
              </>
            )
          ) : (
            /* ── Sign in form ── */
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-1 text-center">Sign in to your account</h1>
              <p className="text-sm text-gray-500 mb-6 text-center">Enter your credentials to continue</p>

              <form onSubmit={handleSignIn} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                  <input type="email" required value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" autoFocus className={INPUT} />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`${INPUT} pr-10`}
                    />
                    <button type="button" onClick={() => setShowPass(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400" />
                    <span className="text-sm text-gray-600">Remember me</span>
                  </label>
                  <button type="button" onClick={() => { setForgotMode(true); setForgotEmail(email); }}
                    className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
                    Forgot password?
                  </button>
                </div>

                {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

                <button type="submit" disabled={loading || !email.trim()}
                  className="w-full flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#1b1b1b' }}
                  onMouseEnter={e => { if (!loading && email.trim()) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#333333'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1b1b1b'; }}>
                  {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>
            </>
          )}
        </div>

        {/* Legal links */}
        <p className="text-center text-xs text-gray-400 mt-5">
          <Link href="/privacy" className="hover:text-gray-600 transition-colors">Privacy Policy</Link>
          {' · '}
          <Link href="/terms" className="hover:text-gray-600 transition-colors">Terms of Use</Link>
        </p>
      </div>
    </div>
  );
}
