'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, X, ArrowRight, Sparkles } from 'lucide-react';

/**
 * Visual + copy primitives for "this feature isn't included in your current
 * plan" UX. Used in two places:
 *
 *   1. Sidebar — when a member clicks a greyed-out locked menu item, we
 *      open `<LockedFeatureModal>` over the dashboard.
 *   2. Direct URL access — when a member somehow navigates to a route their
 *      plan does not include, `<DirectoryRouteGuard>` renders the
 *      `<LockedFeatureScreen>` inline so the page is never blank and the
 *      sidebar stays available for them to navigate elsewhere.
 *
 * Single source of truth for the upgrade copy and CTA so both surfaces stay
 * in sync if marketing tweaks the wording.
 */

export interface LockedFeatureBodyProps {
  /** Pretty name of the locked feature, e.g. "Pricing Guide". */
  featureName?: string;
  /** Optional one-liner that explains what this feature does. */
  featureDescription?: string;
  /** Plan tier label that unlocks the feature, e.g. "Marketing tier". */
  requiredTier?: string;
}

const DEFAULT_DESCRIPTION =
  'This feature is part of one of our higher-tier plans. Upgrade to unlock it for your venue.';

function LockedFeatureBody({
  featureName,
  featureDescription,
  requiredTier,
}: LockedFeatureBodyProps) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg">
        <Lock size={22} />
      </div>
      <h2 className="font-heading text-2xl text-gray-900">
        {featureName ? `${featureName} is locked` : 'This feature is locked'}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-gray-600">
        {featureDescription || DEFAULT_DESCRIPTION}
      </p>
      {requiredTier && (
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
          Available on the <span className="font-semibold text-gray-700">{requiredTier}</span>.
        </p>
      )}

      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          href="/dashboard/directory-billing"
          className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          <Sparkles size={14} /> View plans &amp; upgrade
          <ArrowRight size={14} />
        </Link>
        <a
          href="mailto:hello@storyvenue.com?subject=Plan%20upgrade%20question"
          className="text-sm font-medium text-gray-500 hover:text-gray-800"
        >
          Talk to us
        </a>
      </div>
    </div>
  );
}

// ─── Modal (sidebar click) ───────────────────────────────────────────────

export function LockedFeatureModal({
  open,
  onClose,
  ...body
}: LockedFeatureBodyProps & {
  open: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <LockedFeatureBody {...body} />
      </div>
    </div>,
    document.body,
  );
}

// ─── Inline page replacement (direct URL access) ─────────────────────────

export function LockedFeatureScreen(props: LockedFeatureBodyProps) {
  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <div className="w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-10 sm:p-12">
        <LockedFeatureBody {...props} />
      </div>
    </div>
  );
}
