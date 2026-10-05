'use client';

/**
 * The Setup Guide's state on the dashboard, loaded once and shared by the
 * modal, the pill, the dashboard card and the sidebar entry, so they always
 * agree.
 */

import { useSyncExternalStore } from 'react';
import type { SetupGuideState, SetupLessonId, SetupLessonState } from '@/lib/setup-guide';

export interface SetupGuideStatus extends SetupGuideState {
  /** When this sign-in happened; the guide opens by itself once per sign-in. */
  loginId: string | null;
}

export const OPEN_SETUP_GUIDE_EVENT = 'storyvenue:open-setup-guide';

let status: SetupGuideStatus | null = null;
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Load (or reload) the guide. Calls made while one is running share it.
 * `unlessFresherThanMs` skips the reload when it was loaded that recently
 * (page-to-page checks don't need a fresh answer every click).
 */
export function refreshSetupGuide(unlessFresherThanMs = 0): Promise<void> {
  if (status && unlessFresherThanMs > 0 && Date.now() - loadedAt < unlessFresherThanMs) return Promise.resolve();
  inflight ??= fetch('/api/onboarding/setup-guide', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<SetupGuideStatus>) : null))
    .then((next) => {
      if (next) {
        status = next;
        loadedAt = Date.now();
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

/** The guide as last loaded, for code that isn't rendering (effects, handlers). */
export function getSetupGuideStatus(): SetupGuideStatus | null {
  return status;
}

/** Open the guide, on a given lesson or the first one still to do. */
export function openSetupGuide(lessonId?: SetupLessonId): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETUP_GUIDE_EVENT, { detail: { lessonId } }));
}

/** Tick a step off (or untick it), then reload the guide. */
export async function tickSetupStep(step: SetupLessonId, done = true): Promise<void> {
  try {
    await fetch('/api/onboarding/setup-guide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step, done }),
    });
  } catch { /* the next load shows the truth */ }
  await refreshSetupGuide();
}

export interface SetupStepLabel {
  /** "Step 03", or "Optional". */
  short: string;
  /** "Step 3 of 8", or "Optional". */
  long: string;
}

/**
 * What to call each step: the ones that count are numbered, an optional one
 * is just "Optional", so the numbers always match the progress count.
 */
export function setupStepLabels(lessons: readonly SetupLessonState[]): Map<SetupLessonId, SetupStepLabel> {
  const total = lessons.filter((l) => !l.optional).length;
  const out = new Map<SetupLessonId, SetupStepLabel>();
  let n = 0;
  for (const l of lessons) {
    if (l.optional) {
      out.set(l.id, { short: 'Optional', long: 'Optional' });
    } else {
      n += 1;
      out.set(l.id, { short: `Step ${String(n).padStart(2, '0')}`, long: `Step ${n} of ${total}` });
    }
  }
  return out;
}
