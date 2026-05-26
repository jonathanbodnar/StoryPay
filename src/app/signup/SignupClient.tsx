'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { ModeToggle } from '@/app/login/LoginClient';
import PasswordStrengthBar from '@/components/PasswordStrengthBar';
import { checkPassword } from '@/lib/password-policy';

/**
 * Unified signup page with a toggle for venue owners vs. wedding couples.
 *
 * The two flows hit different backends:
 *  - Venue: POST /api/auth/signup (magic-link sign-in, no password).
 *  - Couple: POST /api/couple/signup (password-based, auto sign-in).
 */

type AuthMode = 'venue' | 'couple';

const INPUT =
  'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 transition-colors';

export function SignupClient() {
  const searchParams = useSearchParams();
  const nextParam = searchParams.get('next') || '';
  const initialMode: AuthMode = searchParams.get('as') === 'couple' ? 'couple' : 'venue';

  const [mode, setMode] = useState<AuthMode>(initialMode);

  const loginHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set('as', mode);
    if (nextParam) params.set('next', nextParam);
    return `/login?${params.toString()}`;
  }, [mode, nextParam]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/">
            <Image src="/storyvenue-logo-dark.png" alt="StoryVenue" width={130} height={32} />
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-7">
          <ModeToggle mode={mode} onChange={setMode} />

          {mode === 'venue' ? <VenueSignupForm /> : <CoupleSignupForm />}
        </div>

        <p className="text-center text-sm text-gray-500 mt-5">
          Already have an account?{' '}
          <Link href={loginHref} className="font-semibold text-gray-900 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

// ───────── Venue signup (email + password) ────────────────────────────────

function VenueSignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // When the marketing site sends a visitor with ?plan=free we skip the
  // plan-picker entirely and route straight through /signup/success so the
  // conversion pixel fires before landing them in the dashboard. Anything
  // else (or no plan param) falls back to whatever the API returns.
  const planParam = searchParams.get('plan');
  const [venueName, setVenueName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const passwordsMatch = password === confirmPassword;
  const pwCheck = checkPassword(password);
  const canSubmit =
    venueName.trim() &&
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    phone.trim() &&
    pwCheck.valid &&
    passwordsMatch;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (!phone.trim()) { setError('Phone number is required.'); return; }
    if (!pwCheck.valid) { setError(pwCheck.message); return; }
    if (!passwordsMatch) { setError('Passwords do not match.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_name:  venueName.trim(),
          first_name:  firstName.trim(),
          last_name:   lastName.trim(),
          email:       email.trim(),
          phone:       phone.trim(),
          password,
          remember_me: rememberMe,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not create your account. Please try again.');
        return;
      }
      // Session cookie is set server-side; redirect through the conversion
      // tracking page so analytics platforms can record the registration.
      // For free-plan signups originating from the marketing site we skip
      // the plan-picker step entirely — straight to success → dashboard.
      const target =
        planParam === 'free'
          ? '/signup/success?plan=free'
          : data.redirect ?? '/signup/success?plan=free';
      router.replace(target);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-bold text-gray-900 mb-1 text-center">Create your venue account</h1>
      <p className="text-sm text-gray-500 mb-3 text-center">
        Get your listing on StoryVenue and start collecting leads in minutes.
      </p>
      <div className="flex items-center justify-center gap-1.5 mb-5">
        <span className="text-base">🇺🇸</span>
        <p className="text-xs text-gray-400 text-center">Currently available in the United States only.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Venue name</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1.5">First name</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Last name</label>
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
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
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
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
          <input
            type="tel"
            required
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            className={INPUT}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className={`${INPUT} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <PasswordStrengthBar password={password} className="mt-2" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm password</label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className={`${INPUT} pr-10 ${confirmPassword && !passwordsMatch ? 'border-red-400 focus:border-red-400 focus:ring-red-200' : ''}`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {confirmPassword && !passwordsMatch && (
            <p className="text-xs text-red-500 mt-1">Passwords do not match.</p>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
          />
          <span className="text-sm text-gray-600">Keep me logged in</span>
        </label>

        {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#1b1b1b' }}
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : null}
          {loading ? 'Creating account...' : 'Create venue account'}
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
  );
}

// ───────── Couple signup (password + confirm password) ────────────────────

function CoupleSignupForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const passwordsMatch = password === confirmPassword;
  const couplePwCheck = checkPassword(password);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) { setError('First name is required.'); return; }
    if (!lastName.trim()) { setError('Last name is required.'); return; }
    if (!phone.trim()) { setError('Phone number is required.'); return; }
    if (!couplePwCheck.valid) { setError(couplePwCheck.message); return; }
    if (!passwordsMatch) { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const res = await fetch('/api/couple/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Sign up failed.');
        return;
      }

      // Account created with email_confirm:true on the server — sign in
      // immediately on the client so they have a session, then redirect.
      const { getCoupleSupabase } = await import('@/lib/couple-browser');
      const supabase = getCoupleSupabase();
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (signInErr) {
        setError('Account created. Please sign in to continue.');
        router.push('/login?as=couple');
        return;
      }

      router.replace('/couple/dashboard');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-bold text-gray-900 mb-1 text-center">Create a couple account</h1>
      <p className="text-sm text-gray-500 mb-6 text-center">
        Save venues to your wish list and keep your wedding profile in one place.
      </p>

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">First name</label>
            <input
              type="text"
              required
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Alex"
              className={INPUT}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Last name</label>
            <input
              type="text"
              required
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Smith"
              className={INPUT}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={INPUT}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
            <input
              type="tel"
              required
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className={INPUT}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              required
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={`${INPUT} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <PasswordStrengthBar password={password} className="mt-2" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm password</label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className={`${INPUT} pr-10 ${confirmPassword && !passwordsMatch ? 'border-red-400 focus:border-red-400 focus:ring-red-200' : ''}`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {confirmPassword && !passwordsMatch && (
            <p className="text-xs text-red-500 mt-1">Passwords do not match.</p>
          )}
        </div>

        {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#1b1b1b' }}
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : null}
          {loading ? 'Creating account...' : 'Create couple account'}
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
  );
}
