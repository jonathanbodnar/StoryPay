'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Synthesized notification chimes for the super-admin Support Inbox, via the
 * Web Audio API — no binary audio assets needed.
 *
 * Browser autoplay policy: browsers block audio (including synthesized
 * AudioContext output) until the page has received a user gesture (click,
 * keypress, tap, etc). We don't work around this — the AudioContext is
 * created lazily on the FIRST chime call attempt (not on page load), and by
 * the time any realtime message arrives the admin has already navigated /
 * clicked into the dashboard, satisfying the gesture requirement. If a chime
 * is ever attempted before any interaction at all, `ctx.resume()` below is a
 * best-effort nudge but may still silently no-op — this is expected and safe
 * (a missed chime is a UX nicety lost, not a functional break).
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function playTone(freqs: number[], durationMs: number, gain = 0.15) {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, now + i * 0.12);
      g.gain.linearRampToValueAtTime(gain, now + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + durationMs / 1000);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + durationMs / 1000 + 0.05);
    });
  } catch {
    // Audio is a nicety — never let a synthesis error break the inbox.
  }
}

/** Bride/contact reply — highest priority, two-tone rising chime. */
export function playBrideReplyChime(): void {
  playTone([880, 1108.73], 0.35, 0.18);
}

/** Venue owner/team reply in a thread — single warm mid tone. */
export function playVenueReplyChime(): void {
  playTone([659.25, 783.99], 0.28, 0.13);
}

/** Internal team-only / support note needing admin attention — soft short blip. */
export function playSupportNoteChime(): void {
  playTone([523.25], 0.18, 0.1);
}

// ─── Mute preference ────────────────────────────────────────────────────────
//
// The Support Inbox panel is split across several sibling components
// (SupportInboxPanel, TicketsView, VenueDirectInboxView, ...) that each need
// to know the current mute state to decide whether to play a chime. Rather
// than threading the mute flag through props everywhere, we keep a tiny
// module-level store here (persisted to localStorage) with a subscribe API,
// mirroring the `use-brand-colors.ts` / `use-brand-socials.ts` pattern
// already used elsewhere in this codebase for cross-component sync.

const MUTE_STORAGE_KEY = 'storypay_admin_inbox_muted';

let mutedState = false;
let initialized = false;
const listeners = new Set<(muted: boolean) => void>();

function ensureInit(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  try {
    mutedState = window.localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    mutedState = false;
  }
}

/** Reads the current mute preference synchronously. Defaults to unmuted. */
export function getInboxSoundMuted(): boolean {
  ensureInit();
  return mutedState;
}

/** Updates the mute preference, persists it, and notifies all subscribers. */
export function setInboxSoundMuted(muted: boolean): void {
  ensureInit();
  mutedState = muted;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
    } catch {
      // Ignore storage failures (e.g. private-browsing quota) — in-memory
      // state still governs the rest of this session.
    }
  }
  listeners.forEach(l => l(muted));
}

/**
 * React hook giving any component in the Support Inbox tree a live,
 * always-current mute flag plus a setter — no prop drilling required.
 */
export function useInboxSoundMuted(): [boolean, (muted: boolean) => void] {
  const [muted, setMuted] = useState<boolean>(() => getInboxSoundMuted());

  useEffect(() => {
    // The useState initializer above already reads the persisted value on
    // the client (including during hydration, since `window` exists then);
    // this effect only needs to subscribe to changes made by OTHER
    // components (e.g. the header mute toggle button).
    listeners.add(setMuted);
    return () => { listeners.delete(setMuted); };
  }, []);

  const update = useCallback((next: boolean) => setInboxSoundMuted(next), []);
  return [muted, update];
}
