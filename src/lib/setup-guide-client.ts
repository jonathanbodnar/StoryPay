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
/**
 * Counts the moments a tick was sent and answered. A load asked for before
 * the latest of them may have been answered from before the tick was saved,
 * so its answer is not shown.
 */
let writes = 0;
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
  return inflight ?? load();
}

/** Ask the server now, whatever is already on its way. */
function load(): Promise<void> {
  const asOf = writes;
  const mine: Promise<void> = fetch('/api/onboarding/setup-guide', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<SetupGuideStatus>) : null))
    .then((next) => {
      if (next && asOf === writes) {
        status = next;
        loadedAt = Date.now();
        for (const l of listeners) l();
      }
    })
    .catch(() => { /* the guide is a helper: never break the dashboard over it */ })
    .finally(() => { if (inflight === mine) inflight = null; });
  inflight = mine;
  return mine;
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

/**
 * Tick a step off (or untick it), then reload the guide.
 *
 * The reload is always a new one. Until Oct 6 2026 it shared whatever load was
 * already on its way (opening the guide starts one), and that one had been
 * answered before the tick was saved: the step was ticked on the server and
 * showed as not done on the screen.
 */
export async function tickSetupStep(step: SetupLessonId, done = true): Promise<void> {
  writes += 1;
  try {
    await fetch('/api/onboarding/setup-guide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step, done }),
    });
  } catch { /* the next load shows the truth */ }
  writes += 1;
  await load();
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
