'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

const INPUT =
  'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 transition-colors';

export default function SignupPage() {
  const [venueName, setVenueName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [phone, setPhone]         = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const [sent, setSent]               = useState(false);
  const [sentEmail, setSentEmail]     = useState('');
  const [devLoginUrl, setDevLoginUrl] = useState<string | null>(null);

  const canSubmit =
    venueName.trim() && firstName.trim() && lastName.trim() && email.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_name: venueName.trim(),
          first_name: firstName.trim(),
          last_name:  lastName.trim(),
          email:      email.trim(),
          phone:      phone.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not create your account. Please try again.');
        return;
      }
      setSentEmail(email.trim());
      setDevLoginUrl(data.login_url ?? null);
      setSent(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/">
            <Image src="/storypay-logo-dark.png" alt="StoryPay" width={130} height={32} />
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          {sent ? (
            <div className="text-center">
              {devLoginUrl ? (
                <>
                  <div className="text-4xl mb-4">🎉</div>
                  <h2 className="text-lg font-bold text-gray-900 mb-2">Account created</h2>
                  <p className="text-sm text-gray-500 leading-relaxed mb-5">
                    We couldn&apos;t send your welcome email, but your account for{' '}
                    <span className="font-medium text-gray-700">{sentEmail}</span> is ready.
                    Click below to log in now.
                  </p>
                  <a
                    href={devLoginUrl}
                    className="inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-white bg-gray-900 hover:bg-gray-800 transition-colors"
                  >
                    Log in to your dashboard →
                  </a>
                </>
              ) : (
                <>
                  <div className="text-4xl mb-4">📬</div>
                  <h2 className="text-lg font-bold text-gray-900 mb-2">Check your inbox</h2>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    We sent a login link to{' '}
                    <span className="font-medium text-gray-700">{sentEmail}</span>. Click
                    it to finish setting up your venue.
                  </p>
                </>
              )}

              <div className="mt-6 text-sm text-gray-500">
                {devLoginUrl ? 'Need to start over?' : "Didn't get it?"}{' '}
                <button
                  onClick={() => {
                    setSent(false);
                    setDevLoginUrl(null);
                  }}
                  className="text-gray-900 underline hover:no-underline"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-1 text-center">
                Create your venue account
              </h1>
              <p className="text-sm text-gray-500 mb-6 text-center">
                Get your listing on StoryVenue and start collecting leads in minutes.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Venue name
                  </label>
                  <input
                    type="text"
                    required
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    placeholder="Magnolia Estate Weddings"
                    autoFocus
                    className={INPUT}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      First name
                    </label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Jane"
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Last name
                    </label>
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Doe"
                      className={INPUT}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourvenue.com"
                    className={INPUT}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Phone <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className={INPUT}
                  />
                </div>

                {error && (
                  <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || !canSubmit}
                  className="w-full flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ backgroundColor: '#1b1b1b' }}
                  onMouseEnter={(e) => {
                    if (!loading && canSubmit)
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#333333';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1b1b1b';
                  }}
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                  {loading ? 'Creating account...' : 'Create Account'}
                </button>

                <p className="text-xs text-gray-400 text-center">
                  By creating an account, you agree to our{' '}
                  <Link href="/terms" className="underline hover:text-gray-600">
                    Terms
                  </Link>{' '}
                  and{' '}
                  <Link href="/privacy" className="underline hover:text-gray-600">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-5">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-gray-900 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
