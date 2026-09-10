'use client';

import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Heart } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';

type State = 'checking' | 'need_auth' | 'claiming' | 'done' | 'error';

export default function CoupleClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [state, setState] = useState<State>('checking');
  const [error, setError] = useState('');
  const ran = useRef(false);

  const nextPath = `/couple/claim/${encodeURIComponent(token)}`;

  const run = useCallback(async () => {
    if (ran.current) return;
    ran.current = true;

    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setState('need_auth');
      return;
    }

    setState('claiming');
    const res = await coupleAuthedFetch('/api/couple/claim', {
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

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div className="mx-auto max-w-md py-10">
      {state === 'checking' && (
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Checking your invite…</p>
        </div>
      )}

      {state === 'need_auth' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <Heart className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
          <h1 className="font-heading text-xl text-gray-900">You&apos;ve been invited</h1>
          <p className="mt-1 text-sm text-gray-500">
            Log in or create your free StoryVenue account to connect with your venue.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <a
              href={`/login?as=couple&next=${encodeURIComponent(nextPath)}`}
              className="rounded-2xl bg-[#1b1b1b] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-85"
            >
              Log in
            </a>
            <a
              href={`/signup?as=couple&next=${encodeURIComponent(nextPath)}`}
              className="rounded-2xl border border-gray-200 px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Create account
            </a>
          </div>
        </div>
      )}

      {state === 'claiming' && (
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Connecting you with your venue…</p>
        </div>
      )}

      {state === 'done' && (
        <div className="rounded-2xl border border-emerald-200 bg-white p-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
          <h1 className="font-heading text-xl text-gray-900">You&apos;re connected!</h1>
          <p className="mt-1 text-sm text-gray-500">Taking you to your wedding…</p>
        </div>
      )}

      {state === 'error' && (
        <div className="rounded-2xl border border-red-200 bg-white p-6 text-center">
          <XCircle className="mx-auto mb-3 h-10 w-10 text-red-400" />
          <h1 className="font-heading text-xl text-gray-900">Invite unavailable</h1>
          <p className="mt-1 text-sm text-gray-500">{error}</p>
          <a href="/couple/wedding" className="mt-4 inline-block text-sm font-medium text-gray-900 underline">
            Go to my wedding
          </a>
        </div>
      )}
    </div>
  );
}
