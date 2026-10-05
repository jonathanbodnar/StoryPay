'use client';

/**
 * "Your plan ends October 27" is shown once after a venue cancels: on the
 * first dashboard visit after it, on each device, and for that visit only
 * (or until they close it). After that it's a chip on the Setup guide bar
 * until the last days (lib/plan-notice.ts).
 *
 * Which end date has been seen is kept in this browser. With storage blocked
 * it simply shows on every visit, as it did before.
 */

import { useCallback, useSyncExternalStore } from 'react';

const SEEN_KEY = 'storyvenue.planEnding.seen';

/** This page load's answer for one end date, so the visit that first shows it keeps showing it. */
let decided: { endsAt: string; show: boolean } | null = null;
const listeners = new Set<() => void>();

function decide(endsAt: string): boolean {
  if (decided?.endsAt !== endsAt) {
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === endsAt;
    } catch {
      seen = false;
    }
    decided = { endsAt, show: !seen };
  }
  return decided.show;
}

function remember(endsAt: string) {
  try {
    window.localStorage.setItem(SEEN_KEY, endsAt);
  } catch {
    /* storage blocked: it shows again next visit */
  }
}

/** [show it now, close it]. Never shown on the server's first paint. */
export function usePlanEndingOnce(endsAt: string | null): [boolean, () => void] {
  const show = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      // Being on screen is what counts as seen.
      if (endsAt && decide(endsAt)) remember(endsAt);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => (endsAt ? decide(endsAt) : false),
    () => false,
  );
  const close = useCallback(() => {
    if (!endsAt) return;
    decided = { endsAt, show: false };
    remember(endsAt);
    listeners.forEach((l) => l());
  }, [endsAt]);
  return [show, close];
}
