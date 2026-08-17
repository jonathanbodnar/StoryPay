'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { isNativeApp } from '@/lib/platform';

function subscribe() {
  return () => {};
}

function getSnapshot() {
  return isNativeApp();
}

/** SSR and the hydration pass treat the shell as native so signup UI never paints. */
function getServerSnapshot() {
  return true;
}

/**
 * Renders signup UI on the web only. Inside the Capacitor shell the children
 * never paint — no plan picker, card form, or trial start — and the webview
 * is sent to /login. Web signup at app.storyvenue.com/signup is unchanged.
 */
export default function NativeSignupBlock({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const native = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (isNativeApp()) router.replace('/login');
  }, [router]);

  if (native) {
    return <div className="min-h-screen bg-gray-50" />;
  }

  return <>{children}</>;
}
