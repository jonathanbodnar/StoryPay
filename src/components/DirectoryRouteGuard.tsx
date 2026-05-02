'use client';

import { usePathname } from 'next/navigation';
import { resolveNavIdForPath, DIRECTORY_NAV_REGISTRY } from '@/lib/directory-nav-registry';
import { LockedFeatureScreen } from '@/components/LockedFeatureView';

/**
 * Plan-aware route guard. When the current pathname maps to a nav id that is
 * NOT in the plan's allow-list, we render a lock screen in place of the page
 * content rather than redirecting. This matches the sidebar UX (locked
 * entries stay visible, click → upgrade prompt) and means a member who lands
 * on a locked URL by direct link, bookmark, or back-button still sees a
 * meaningful page with a way forward.
 *
 * `null` allowedNavIds means full access (legacy_full venues without a plan)
 * — the original page renders unchanged.
 */
export function DirectoryRouteGuard({
  allowedNavIds,
  children,
}: {
  allowedNavIds: string[] | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (allowedNavIds === null) return <>{children}</>;

  const id = resolveNavIdForPath(pathname);

  // Unknown route — allow it through. Better than locking out users on
  // routes that simply weren't added to the registry yet (e.g. transient
  // detail pages under a known group).
  if (!id) return <>{children}</>;

  if (allowedNavIds.includes(id)) return <>{children}</>;

  // Locked: pull a friendly label from the registry so the lock screen says
  // "Pricing Guide is locked" instead of an opaque nav id.
  const entry = DIRECTORY_NAV_REGISTRY.find((e) => e.id === id);
  const featureName = entry?.label?.replace(/^[^—]*—\s*/, '') ?? entry?.label;

  return <LockedFeatureScreen featureName={featureName} />;
}
