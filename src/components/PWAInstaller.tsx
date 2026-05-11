'use client';

/**
 * Registers the service worker (public/sw.js) and renders the install UX.
 *
 *   - Android / desktop Chromium: captures the browser's `beforeinstallprompt`
 *     event and exposes a small floating "Install app" button that calls
 *     `prompt()` from the user-gesture click handler. Once the user installs
 *     (or dismisses for the session), we hide it and remember the choice in
 *     localStorage for 30 days.
 *
 *   - iOS Safari: there is no install API on iOS. We detect Safari running
 *     standalone-eligible (iOS 13+) and render a one-time coach that
 *     explains "tap Share → Add to Home Screen". Dismissals persist for
 *     30 days.
 *
 *   - Already-installed PWA / in-app browsers: render nothing.
 *
 * Pure UI helper — safe to mount once at the root layout.
 */

import { useEffect, useState } from 'react';

// ── Storage keys ─────────────────────────────────────────────────────────────
const DISMISS_KEY = 'storyvenue.pwa.dismissed_at';
const IOS_COACH_KEY = 'storyvenue.pwa.ios_coach_dismissed_at';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Types ────────────────────────────────────────────────────────────────────
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // Android / desktop installed PWA: matches the manifest display mode.
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari standalone (legacy, non-standard but only signal on iOS):
  const navWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return navWithStandalone.standalone === true;
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  // iPadOS 13+ reports as Macintosh — also check touch points.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && 'ontouchend' in document)
  );
}

function isSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  // Exclude Chrome / Edge / Firefox iOS skins (they also can't install PWAs).
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Android/.test(ua);
}

function isIOSChrome(): boolean {
  if (typeof window === 'undefined') return false;
  return /CriOS/.test(window.navigator.userAgent);
}

function dismissedRecently(key: string): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function markDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    /* private mode / quota — best effort */
  }
}

// ── Component ────────────────────────────────────────────────────────────────
export default function PWAInstaller() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosCoach, setShowIosCoach] = useState(false);

  // Service worker registration. Wrapped in an effect so it never runs at SSR.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Defer until after first paint to avoid contending with page hydration.
    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch((err) => {
          console.warn('[pwa] service worker registration failed', err);
        });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }
  }, []);

  // beforeinstallprompt capture — Android / desktop Chromium only.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone()) return;
    if (dismissedRecently(DISMISS_KEY)) return;

    const onPrompt = (e: Event) => {
      // Prevent the mini-infobar; we render our own button.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      markDismissed(DISMISS_KEY);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // iOS coach decision. iOS never fires `beforeinstallprompt` regardless of
  // which browser is used (all iOS browsers run on WebKit). Show the coach
  // for Safari AND Chrome iOS (CriOS) — the instructions differ slightly but
  // both need guidance since there's no automated install prompt.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone()) return;
    if (!isIOS()) return;
    if (dismissedRecently(IOS_COACH_KEY)) return;

    const t = window.setTimeout(() => setShowIosCoach(true), 2500);
    return () => window.clearTimeout(t);
  }, []);

  async function handleInstall() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted' || choice.outcome === 'dismissed') {
        markDismissed(DISMISS_KEY);
      }
    } catch {
      /* user cancelled */
    } finally {
      setDeferred(null);
    }
  }

  function handleDismissAndroid() {
    markDismissed(DISMISS_KEY);
    setDeferred(null);
  }

  function handleDismissIos() {
    markDismissed(IOS_COACH_KEY);
    setShowIosCoach(false);
  }

  if (!deferred && !showIosCoach) return null;

  return (
    <>
      {deferred && (
        <div
          role="dialog"
          aria-label="Install StoryVenue"
          style={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px 10px 14px',
            borderRadius: 14,
            background: '#1b1b1b',
            color: '#ffffff',
            boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
            maxWidth: 'min(92vw, 420px)',
            fontFamily: "'Open Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/storyvenue-sidebar-mark.png"
            alt=""
            width={28}
            height={28}
            style={{ borderRadius: 6, flexShrink: 0 }}
          />
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.35 }}>
            <div style={{ fontWeight: 600 }}>Install StoryVenue</div>
            <div style={{ opacity: 0.7, fontSize: 12 }}>
              Faster access from your home screen.
            </div>
          </div>
          <button
            type="button"
            onClick={handleInstall}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              background: '#ffffff',
              color: '#1b1b1b',
              fontSize: 13,
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Install
          </button>
          <button
            type="button"
            onClick={handleDismissAndroid}
            aria-label="Dismiss"
            style={{
              padding: 6,
              borderRadius: 8,
              background: 'transparent',
              color: 'rgba(255,255,255,0.6)',
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
      )}

      {showIosCoach && (
        <div
          role="dialog"
          aria-label="Add StoryVenue to your home screen"
          style={{
            position: 'fixed',
            left: 12,
            right: 12,
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
            zIndex: 9999,
            padding: '12px 14px',
            borderRadius: 14,
            background: '#ffffff',
            color: '#1b1b1b',
            border: '1px solid #e5e7eb',
            boxShadow: '0 12px 28px rgba(0,0,0,0.10)',
            fontFamily: "'Open Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/storyvenue-sidebar-mark.png"
              alt=""
              width={32}
              height={32}
              style={{ borderRadius: 8, flexShrink: 0, marginTop: 2 }}
            />
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Add to Home Screen</div>
            {isIOSChrome() ? (
              <div style={{ color: '#6b7280' }}>
                Tap the <ShareGlyph /> Share icon in the address bar (or <strong>⋮ → Add to Home Screen</strong>) to install StoryVenue.
              </div>
            ) : (
              <div style={{ color: '#6b7280' }}>
                Tap the <ShareGlyph /> Share icon, then <strong>&ldquo;Add to Home Screen&rdquo;</strong> to install StoryVenue.
              </div>
            )}
          </div>
            <button
              type="button"
              onClick={handleDismissIos}
              aria-label="Dismiss"
              style={{
                padding: 4,
                borderRadius: 8,
                background: 'transparent',
                color: '#9ca3af',
                border: 'none',
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ShareGlyph() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: '-2px', color: '#3b82f6' }}
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}
