'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * On `/dashboard` exactly, redirect mobile / tablet users to the mobile
 * home hub (`/dashboard/home`). Desktop users (>= lg breakpoint, 1024px)
 * stay on the standard dashboard. Detection is window-width based so it
 * naturally adapts to device rotation and split-screen.
 */
export default function MobileDashboardRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname !== '/dashboard') return;
    if (typeof window === 'undefined') return;

    // Tailwind's lg breakpoint = 1024px
    const isMobile = window.matchMedia('(max-width: 1023.98px)').matches;
    if (isMobile) {
      router.replace('/dashboard/home');
    }
  }, [pathname, router]);

  return null;
}
