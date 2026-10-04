'use client';

/**
 * The Setup Guide's state on the dashboard, loaded once and shared by the
 * modal, the dashboard card and the sidebar entry, so they always agree.
 */

import { useSyncExternalStore } from 'react';
import type { SetupLessonId } from '@/lib/setup-guide';

export interface SetupGuideStatus {
  eligible: boolean;
  /** Being walked through it: the card shows on the dashboard home. */
  guided: boolean;
  autoOpen: boolean;
  /** When this sign-in happened; the guide opens by itself once per sign-in. */
  loginId: string | null;
  complete: boolean;
  done: number;
  total: number;
  lessons: Array<{ id: SetupLessonId; done: boolean }>;
  videos: Partial<Record<SetupLessonId, string>>;
  listingUrl: string | null;
}

export const OPEN_SETUP_GUIDE_EVENT = 'storyvenue:open-setup-guide';

let status: SetupGuideStatus | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Load (or reload) the guide. Calls made while one is running share it. */
export function refreshSetupGuide(): Promise<void> {
  inflight ??= fetch('/api/onboarding/setup-guide', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<SetupGuideStatus>) : null))
    .then((next) => {
      if (next) {
        status = next;
        for (const l of listeners) l();
      }
    })
    .catch(() => { /* the guide is a helper: never break the dashboard over it */ })
    .finally(() => { inflight = null; });
  return inflight;
}

/** The guide for this venue; null until it has loaded (and on the server). */
export function useSetupGuideStatus(): SetupGuideStatus | null {
  return useSyncExternalStore(subscribe, () => status, () => null);
}

/** Open the guide, on a given lesson or the first one still to do. */
export function openSetupGuide(lessonId?: SetupLessonId): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETUP_GUIDE_EVENT, { detail: { lessonId } }));
}

/** The guide as last loaded, for code that isn't rendering (effects, handlers). */
export function getSetupGuideStatus(): SetupGuideStatus | null {
  return status;
}

/** Tick one of the steps that has nothing to detect, then reload the guide. */
export async function tickSetupStep(step: SetupLessonId): Promise<void> {
  try {
    await fetch('/api/onboarding/setup-guide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step }),
    });
  } catch { /* the next load shows the truth */ }
  await refreshSetupGuide();
}
