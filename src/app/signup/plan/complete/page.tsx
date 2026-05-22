'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

type Status = 'verifying' | 'success' | 'error';

export default function SignupPlanCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
          <Loader2 size={32} className="animate-spin text-gray-400" />
        </div>
      }
    >
      <CompleteInner />
    </Suspense>
  );
}

function CompleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const isCheckout = searchParams.get('checkout') === '1';

  const [status, setStatus] = useState<Status>('verifying');
  const [errorMsg, setErrorMsg] = useState('');
  const verified = useRef(false);

  useEffect(() => {
    if (verified.current) return;
    verified.current = true;

    if (!isCheckout || !sessionId) {
      // No session → skip directly to dashboard (free plan or direct navigation)
      router.replace('/signup/success?plan=free');
      return;
    }

    async function verify() {
      try {
        const res = await fetch('/api/venue-billing/signup-checkout/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        });
        let data: Record<string, unknown> = {};
        try {
          data = await res.json();
        } catch {
          // Server returned non-JSON (crashed before sending JSON response)
          setErrorMsg(`Server error (HTTP ${res.status}). Please try again or contact support and reference session ID: ${sessionId}`);
          setStatus('error');
          return;
        }
        if (!res.ok) {
          setErrorMsg((data.error as string) || 'Verification failed. Please contact support.');
          setStatus('error');
          return;
        }
        setStatus('success');
        setTimeout(() => router.replace('/signup/success?plan=paid'), 1800);
      } catch {
        setErrorMsg('Could not reach the server. Check your connection and try again.');
        setStatus('error');
      }
    }

    verify();
  }, [isCheckout, sessionId, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="mb-8">
        <Image src="/storyvenue-logo-dark.png" alt="StoryVenue" width={120} height={30} />
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm text-center">
        {status === 'verifying' && (
          <>
            <Loader2 size={36} className="mx-auto mb-4 animate-spin text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900">Activating your trial…</h2>
            <p className="mt-2 text-sm text-gray-500">
              We&apos;re setting up your account. This only takes a moment.
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-500" />
            <h2 className="text-lg font-semibold text-gray-900">You&apos;re all set!</h2>
            <p className="mt-2 text-sm text-gray-500">
              Your 14-day free trial is active. Redirecting to your dashboard…
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle size={40} className="mx-auto mb-4 text-red-400" />
            <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
            <p className="mt-2 text-sm text-red-500">{errorMsg}</p>
            <p className="mt-3 text-xs text-gray-500">
              If your card was already charged, &ldquo;Try again&rdquo; will safely retry
              without re-charging. You can also continue to your dashboard
              and we&apos;ll finish setup there.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => {
                  verified.current = false;
                  setStatus('verifying');
                  setErrorMsg('');
                  window.location.reload();
                }}
                className="w-full rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-85"
              >
                Try again
              </button>
              <button
                onClick={() => router.replace('/signup/success?plan=paid')}
                className="w-full rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                Continue to dashboard
              </button>
              <a
                href="mailto:support@storyvenue.com"
                className="mt-1 text-center text-xs text-gray-400 hover:text-gray-600"
              >
                Email support
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
