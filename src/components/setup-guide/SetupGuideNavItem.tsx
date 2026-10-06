'use client';

import { isNativeApp } from '@/lib/platform';
import { setupGuideDisplay } from '@/lib/setup-guide';
import { openSetupGuide, useSetupGuideStatus } from '@/lib/setup-guide-client';
import ProgressRing from './ProgressRing';

/**
 * The sidebar's way back into the Setup Guide, with how far along the venue
 * is: the same green ring as the guide's bar, on every page, and the count.
 * It goes, with the pop-up and the bar, once the venue has completed the
 * checklist (owner's rule, Oct 6 2026: "those big alerts aren't needed any
 * longer"). Until then every venue owner had it for good, to rewatch a lesson.
 */
export default function SetupGuideNavItem({
  rail,
  className,
  onNavigate,
}: {
  rail: boolean;
  /** The sidebar's own nav-item classes, so it sits with the rows around it. */
  className: string;
  onNavigate?: () => void;
}) {
  const status = useSetupGuideStatus();
  if (!status?.eligible || status.finished || isNativeApp()) return null;
  const shown = setupGuideDisplay(status);

  return (
    <button
      type="button"
      title={rail ? 'Setup Guide' : undefined}
      onClick={() => {
        onNavigate?.();
        openSetupGuide();
      }}
      className={className}
    >
      {/* Sized to sit on the 16px icon column of the rows around it. */}
      <span className="relative -m-[3px] flex items-center justify-center">
        <ProgressRing done={shown.done} total={shown.total} size={22} />
      </span>
      {!rail && (
        <>
          <span className="min-w-0 flex-1 truncate text-left">Setup Guide</span>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-gray-400">
            {shown.done}/{shown.total}
          </span>
        </>
      )}
    </button>
  );
}
