'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle, Heart, Eye, Pencil } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';

type InviteCtx = {
  name: string | null;
  email: string | null;
  phone: string | null;
  access_level: 'view' | 'edit';
  role: string | null;
  status: string;
  alreadyAccepted: boolean;
};

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200';

function AcceptInviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [state, setState] = useState<'loading' | 'form' | 'binding' | 'done' | 'error' | 'login'>('loading');
  const [error, setError] = useState('');
  const [invite, setInvite] = useState<InviteCtx | null>(null);
  const [venueName, setVenueName] = useState<string | null>(null);
  const [inviterName, setInviterName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ran = useRef(false);

  const nextPath = `/couple/accept-invite?token=${encodeURIComponent(token)}`;

  const bindExisting = useCallback(async () => {
    setState('binding');
    const res = await coupleAuthedFetch('/api/couple/accept-invite', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'Could not accept this invite.');
      setState('error');
      return;
    }
    setState('done');
    setTimeout(() => router.replace('/couple/wedding'), 1200);
  }, [router, token]);

  const init = useCallback(async () => {
    if (ran.current) return;
    ran.current = true;

    if (!token) {
      setError('This invite link is missing its token.');
      setState('error');
      return;
    }

    const res = await fetch(`/api/couple/accept-invite?token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'This invite is no longer valid.');
      setState('error');
      return;
    }
    setInvite(data.invite as InviteCtx);
    setVenueName(data.venueName ?? null);
    setInviterName(data.inviterName ?? null);

    // Already signed in? Bind immediately.
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await bindExisting();
      return;
    }
    setState('form');
  }, [token, bindExisting]);

  useEffect(() => {
    void init();
  }, [init]);

  async function submitSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!invite?.email) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/couple/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.accountExists) {
        setState('login');
        return;
      }
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not create your account.');
        return;
      }
      // Sign in with the new account, then bind is already done server-side.
      const supabase = getCoupleSupabase();
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email: invite.email, password });
      if (signInErr) {
        // Account + access are set up; just send them to log in.
        setState('login');
        return;
      }
      setState('done');
      setTimeout(() => router.replace('/couple/wedding'), 1200);
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'loading' || state === 'binding') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">{state === 'binding' ? 'Setting up your access…' : 'Checking your invite…'}</p>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="mx-auto max-w-md py-10">
        <div className="rounded-2xl border border-emerald-200 bg-white p-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
          <h1 className="font-heading text-xl text-gray-900">You&apos;re in!</h1>
          <p className="mt-1 text-sm text-gray-500">Taking you to the Wedding Planner…</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="mx-auto max-w-md py-10">
        <div className="rounded-2xl border border-red-200 bg-white p-6 text-center">
          <XCircle className="mx-auto mb-3 h-10 w-10 text-red-400" />
          <h1 className="font-heading text-xl text-gray-900">Invite unavailable</h1>
          <p className="mt-1 text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (state === 'login') {
    return (
      <div className="mx-auto max-w-md py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <Heart className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
          <h1 className="font-heading text-xl text-gray-900">Log in to accept</h1>
          <p className="mt-1 text-sm text-gray-500">
            You already have a StoryVenue account. Log in and we&apos;ll finish connecting you.
          </p>
          <a
            href={`/login?as=couple&next=${encodeURIComponent(nextPath)}`}
            className="mt-5 inline-flex rounded-2xl bg-[#1b1b1b] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-85"
          >
            Log in
          </a>
        </div>
      </div>
    );
  }

  // state === 'form'
  const canEdit = invite?.access_level === 'edit';
  return (
    <div className="mx-auto max-w-md py-10">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex items-center gap-3 border-b border-emerald-100 bg-emerald-50 px-5 py-3">
          <Heart className="h-5 w-5 text-emerald-600" />
          <p className="text-sm font-medium text-emerald-800">
            {inviterName || 'A couple'} invited you to help plan their wedding
          </p>
        </div>
        <div className="px-5 py-5">
          <p className="text-sm text-gray-600">
            Create your free account to help with{' '}
            <strong>{venueName ? `${venueName}'s` : 'the'}</strong> Wedding Planner. You&apos;ll get{' '}
            <span className="inline-flex items-center gap-1 font-medium text-gray-900">
              {canEdit ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {canEdit ? 'edit' : 'view-only'}
            </span>{' '}
            access to every planning tool except the couple&apos;s private budget.
          </p>

          <form onSubmit={submitSignup} className="mt-5 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Name</label>
              <input className={`${INPUT} bg-gray-50`} value={invite?.name ?? ''} readOnly />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Email</label>
              <input className={`${INPUT} bg-gray-50`} value={invite?.email ?? ''} readOnly />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Phone</label>
              <input className={`${INPUT} bg-gray-50`} value={invite?.phone ?? ''} readOnly />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Create a password
              </label>
              <input
                type="password"
                className={INPUT}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                required
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
            )}

            <button
              type="submit"
              disabled={submitting || !password}
              className="w-full rounded-2xl bg-[#1b1b1b] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null} Create account & accept
            </button>
            <p className="text-center text-xs text-gray-400">
              Already have an account?{' '}
              <a href={`/login?as=couple&next=${encodeURIComponent(nextPath)}`} className="font-medium text-gray-700 underline">
                Log in
              </a>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <AcceptInviteInner />
    </Suspense>
  );
}
