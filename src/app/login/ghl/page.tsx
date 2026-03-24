'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function GHLLoginContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'resolving' | 'error'>('resolving');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let locationId: string | null = null;

    const qp = searchParams.get('locationId');
    if (qp) {
      locationId = qp;
    }

    if (!locationId && document.referrer) {
      const match = document.referrer.match(/\/location\/([a-zA-Z0-9]+)/);
      if (match) {
        locationId = match[1];
      }
    }

    if (!locationId) {
      setErrorMsg(
        'Unable to identify your venue. Please access StoryPay from your dashboard, or contact support.'
      );
      setStatus('error');
      return;
    }

    window.location.href = `/api/auth/ghl/${locationId}`;
  }, [searchParams]);

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="font-heading text-2xl text-gray-900 mb-3">Venue Not Recognized</h1>
          <p className="text-gray-500 text-sm">{errorMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex items-center gap-3 text-gray-400">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        Signing you in…
      </div>
    </div>
  );
}

export default function GHLLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-pulse text-gray-400">Loading…</div>
        </div>
      }
    >
      <GHLLoginContent />
    </Suspense>
  );
}
