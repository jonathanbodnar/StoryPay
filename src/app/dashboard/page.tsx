'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isNativeApp } from '@/lib/platform';

/**
 * Dashboard entry point. Native app users land on the mobile "Today" home
 * screen; web users go to the full Bride Booking System dashboard. Detection is
 * client-side (Capacitor), so this branch has to run in the browser.
 */
export default function DashboardRoot() {
  const router = useRouter();

  useEffect(() => {
    router.replace(isNativeApp() ? '/dashboard/home' : '/dashboard/listing');
  }, [router]);

  return null;
}
