'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { resolveNavIdForPath } from '@/lib/directory-nav-registry';

export function DirectoryRouteGuard({
  allowedNavIds,
  children,
}: {
  allowedNavIds: string[] | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (allowedNavIds === null) return;
    const id = resolveNavIdForPath(pathname);
    if (!id || !allowedNavIds.includes(id)) {
      router.replace('/dashboard');
    }
  }, [pathname, allowedNavIds, router]);

  return <>{children}</>;
}
