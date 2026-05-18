'use client';

import { usePathname } from 'next/navigation';
import { resolveNavIdForPath, DIRECTORY_NAV_REGISTRY } from '@/lib/directory-nav-registry';
import { LockedFeatureOverlay } from '@/components/LockedFeatureView';

/**
 * Plan-aware route guard. When the current pathname maps to a nav id that is
 * NOT in the plan's allow-list, we render the page content blurred behind an
 * upgrade card rather than replacing it entirely. This gives locked users a
 * preview of what they're missing and motivates them to upgrade.
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

  // Unknown route — allow through rather than locking out users on routes
  // not yet added to the registry (e.g. transient detail pages).
  if (!id) return <>{children}</>;

  if (allowedNavIds.includes(id)) return <>{children}</>;

  // Locked: strip the group prefix from the label so the card says
  // "Pricing Guide" instead of "Listing — Pricing Guide".
  const entry = DIRECTORY_NAV_REGISTRY.find((e) => e.id === id);
  const featureName = entry?.label?.replace(/^[^—]*—\s*/, '') ?? entry?.label;

  return (
    <LockedFeatureOverlay featureName={featureName} navId={id}>
      {children}
    </LockedFeatureOverlay>
  );
}
