'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { isNativeApp } from '@/lib/platform';

/**
 * Couple index. On native the app opens into the "My wedding" hub (matching the
 * post-login landing); on the web the default surface stays the Favorites list.
 */
export default function CoupleIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(isNativeApp() ? '/couple/wedding' : '/couple/favorites');
  }, [router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
    </div>
  );
}
