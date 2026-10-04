'use client';

import { Check, GraduationCap } from 'lucide-react';
import { isNativeApp } from '@/lib/platform';
import { openSetupGuide, useSetupGuideStatus } from '@/lib/setup-guide-client';

/**
 * The sidebar's way back into the Setup Guide, with how far along the venue
 * is. Every venue owner has it, finished or not, to rewatch a lesson.
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
  if (!status?.eligible || isNativeApp()) return null;

  return (
    <button
      type="button"
      title={rail ? 'Setup guide' : undefined}
      onClick={() => {
        onNavigate?.();
        openSetupGuide();
      }}
      className={className}
    >
      <span className="relative flex items-center justify-center">
        <GraduationCap size={16} className="shrink-0" />
      </span>
      {!rail && (
        <>
          <span className="min-w-0 flex-1 truncate text-left">Setup guide</span>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-gray-400">
            {status.complete ? <Check size={14} aria-label="All done" /> : `${status.done}/${status.total}`}
          </span>
        </>
      )}
    </button>
  );
}
