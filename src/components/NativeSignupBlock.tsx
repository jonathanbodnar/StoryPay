'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { isNativeApp } from '@/lib/platform';

/**
 * Couple signup is free (no billing) so it may render in-app; venue signup can
 * lead into a paid plan, so it must never appear inside the native binary. On
 * native we therefore block every /signup* screen EXCEPT `/signup?as=couple`.
 * Read from `window.location.search` directly so this stays SSR-safe and needs
 * no Suspense boundary.
 */
function shouldBlockOnNative(): boolean {
  if (!isNativeApp()) return false;
  if (typeof window === 'undefined') return true;
  const params = new URLSearchParams(window.location.search);
  return params.get('as') !== 'couple';
}

function subscribe() {
  return () => {};
}

function getSnapshot() {
  return shouldBlockOnNative();
}

/** SSR and the hydration pass block by default so venue signup UI never flashes. */
function getServerSnapshot() {
  return true;
}

/**
 * Renders signup UI on the web, plus the free couple signup flow in the native
 * app. Native venue signup never paints — no plan picker, card form, or trial
 * start — and the webview is sent to /login.
 */
export default function NativeSignupBlock({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const blocked = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (shouldBlockOnNative()) router.replace('/login');
  }, [router]);

  if (blocked) {
    return <div className="min-h-screen bg-gray-50" />;
  }

  return <>{children}</>;
}
