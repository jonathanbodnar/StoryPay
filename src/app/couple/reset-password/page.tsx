'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { getCoupleSupabase } from '@/lib/couple-browser';

const INPUT =
  'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 transition-colors';

export default function CoupleResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword]     = useState('');
  const [confirm, setConfirm]       = useState('');
  const [showPass, setShowPass]     = useState(false);
  const [showConf, setShowConf]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [done, setDone]             = useState(false);
  const [error, setError]           = useState('');
  const [ready, setReady]           = useState(false);

  // Supabase embeds the tokens in the URL fragment (#access_token=...&type=recovery).
  // We exchange the hash for a live session so updateUser works.
  useEffect(() => {
    const supabase = getCoupleSupabase();

    // Handle the PKCE / implicit token from the email link
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });

    // Also check if already signed in with a recovery session
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
  }, []);

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
      const supabase = getCoupleSupabase();
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) {
        setError(updateErr.message);
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/login?as=couple'), 2500);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Link href="/">
            <Image src="/storyvenue-logo-dark.png" alt="StoryVenue" width={130} height={32} />
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-7">
          {done ? (
            <div className="text-center">
              <CheckCircle2 size={40} className="mx-auto text-green-500 mb-4" />
              <h2 className="text-lg font-bold text-gray-900 mb-2">Password updated!</h2>
              <p className="text-sm text-gray-500">Redirecting you to sign in…</p>
            </div>
          ) : !ready ? (
            <div className="text-center py-6">
              <Loader2 size={28} className="animate-spin mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">Verifying your reset link…</p>
              <p className="text-xs text-gray-400 mt-2">
                If nothing happens,{' '}
                <Link href="/login?as=couple" className="underline hover:text-gray-600">
                  go back to sign in
                </Link>.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-1 text-center">Set new password</h1>
              <p className="text-sm text-gray-500 mb-6 text-center">Choose a strong password for your account.</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">New password</label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoFocus
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className={`${INPUT} pr-10`}
                    />
                    <button type="button" onClick={() => setShowPass((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm new password</label>
                  <div className="relative">
                    <input
                      type={showConf ? 'text' : 'password'}
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Re-enter password"
                      className={`${INPUT} pr-10 ${confirm && confirm !== password ? 'border-red-400 focus:border-red-400' : ''}`}
                    />
                    <button type="button" onClick={() => setShowConf((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showConf ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {confirm && confirm !== password && (
                    <p className="text-xs text-red-500 mt-1">Passwords do not match.</p>
                  )}
                </div>

                {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white hover:opacity-85 disabled:cursor-not-allowed transition-opacity"
                  style={{ backgroundColor: '#1b1b1b' }}
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                  {loading ? 'Updating…' : 'Update Password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
