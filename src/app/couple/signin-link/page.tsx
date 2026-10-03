'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Lands a one-time sign-in link (admin "Login as bride") and opens the
 * couple's wedding hub. The link carries a token for THIS page to confirm
 * (verifyOtp), so it never depends on the login service's list of allowed
 * return addresses — which silently sends links to the wrong place when a
 * site isn't on it (the couple reset flow hit the same thing, Oct 2026).
 */
export default function CoupleSignInLinkPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    if (!tokenHash) {
      setFailed(true);
      return;
    }
    void (async () => {
      const { getCoupleSupabase } = await import('@/lib/couple-browser');
      const { error } = await getCoupleSupabase().auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
      window.history.replaceState({}, '', window.location.pathname);
      if (error) setFailed(true);
      else router.replace('/couple/wedding');
    })();
  }, [router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="text-center">
        {failed ? (
          <>
            <h1 className="text-lg font-semibold text-gray-900">This sign-in link has expired or was already used</h1>
            <p className="mt-2 text-sm text-gray-600">Request a fresh one, or sign in with your email and password.</p>
            <a href="/couple/login" className="mt-4 inline-block text-sm font-medium text-gray-900 underline">
              Go to sign in
            </a>
          </>
        ) : (
          <p className="text-sm text-gray-600">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
