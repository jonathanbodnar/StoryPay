'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Client-side hop to the dashboard for already-signed-in visitors to /login.
 *
 * This MUST stay a client-side router.replace, not a server redirect(): the
 * app-store binary shipped without `allowNavigation` in its Capacitor config,
 * so any full-page HTTP redirect off /login (e.g. Location: /dashboard) gets
 * rejected by the native WKWebView navigation delegate and handed to the
 * system browser (Safari/Chrome) instead of staying in the app. A soft
 * Next.js router navigation never touches the navigation delegate, so it
 * works on every binary — including the old one — and behaves identically
 * on the web.
 */
export default function LoginRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 text-sm text-gray-500">
      Loading…
    </div>
  );
}
