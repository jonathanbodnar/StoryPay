'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isNativeApp } from '@/lib/platform';

function isBlockedNativeSignupPath(pathname: string): boolean {
  // Couple signup is free and allowed in-app.
  if (pathname === '/couple/signup' || pathname.startsWith('/couple/signup/')) return false;
  if (pathname === '/signup') {
    // Allow the free couple signup flow; block the default/venue variant.
    const params =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    return params?.get('as') !== 'couple';
  }
  // Every other /signup/* subpage (e.g. /signup/success) is venue-only.
  return pathname.startsWith('/signup/');
}

/**
 * Global native-shell guard: in-webview navigation to venue account-creation
 * routes is sent to /login. Complements NativeSignupBlock so deep links and
 * client-side pushes never show the venue registration screen inside the
 * binary. The free couple signup flow (`/signup?as=couple`, `/couple/signup`)
 * is allowed through.
 */
export default function NativeLoginOnlyGuard() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isNativeApp()) return;
    if (isBlockedNativeSignupPath(pathname)) {
      router.replace('/login');
    }
  }, [pathname, router]);

  return null;
}
