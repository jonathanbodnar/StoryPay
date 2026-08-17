'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isNativeApp } from '@/lib/platform';

function isBlockedNativeSignupPath(pathname: string): boolean {
  return (
    pathname === '/signup' ||
    pathname.startsWith('/signup/') ||
    pathname === '/couple/signup' ||
    pathname.startsWith('/couple/signup/')
  );
}

/**
 * Global native-shell guard: any in-webview navigation to account-creation
 * routes is sent to /login. Complements NativeSignupBlock so deep links and
 * client-side pushes never show a registration screen inside the binary.
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
