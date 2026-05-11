'use client';

/**
 * Reusable "Install the StoryVenue app" card.
 *
 * Used in two places:
 *   1. Settings → General (always visible, never dismissed)
 *   2. Dashboard Home (dismissable banner, hidden once installed)
 *
 * Handles three platforms:
 *   - Chrome / Edge / Android: captures beforeinstallprompt; falls back to
 *     explaining the address-bar install icon when the event hasn't fired yet
 *     (Chrome only fires it once per session and suppresses it when it thinks
 *     the user isn't engaged).
 *   - iOS Safari (not standalone): shows Share → Add to Home Screen steps.
 *   - Already installed (standalone mode): shows a "you're all set" state.
 *
 * Props:
 *   variant  'card'   — bordered card, used in Settings (never dismissable)
 *            'banner' — flat top-of-page banner with dismiss button
 *   onDismiss — only called when variant='banner' and the × is clicked
 */

import { useEffect, useState } from 'react';
import { Smartphone, Monitor, CheckCircle2, X, Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOS() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
}

function isSafari() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Android/.test(ua);
}

function isIOSChrome() {
  if (typeof window === 'undefined') return false;
  return /CriOS/.test(window.navigator.userAgent);
}

function isIOSOtherBrowser() {
  // Firefox iOS (FxiOS), Edge iOS (EdgiOS), etc. — all WebKit underneath,
  // none support beforeinstallprompt. Share → Add to Home Screen is the
  // universal fallback but the UI varies by browser.
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  return isIOS() && !isSafari() && !isIOSChrome();
}
void isIOSOtherBrowser; // referenced in future variants

type Platform = 'loading' | 'installed' | 'ios-safari' | 'ios-chrome' | 'prompt-ready' | 'prompt-unavailable';

interface Props {
  variant?: 'card' | 'banner';
  onDismiss?: () => void;
}

export default function InstallAppCard({ variant = 'card', onDismiss }: Props) {
  const [platform, setPlatform]     = useState<Platform>('loading');
  const [deferred, setDeferred]     = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [done, setDone]             = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isStandalone()) { setPlatform('installed'); return; }

    if (isIOSChrome()) { setPlatform('ios-chrome'); return; }
    if (isIOS() && !isIOSChrome()) { setPlatform('ios-safari'); return; }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setPlatform('prompt-ready');
    };
    const onInstalled = () => { setPlatform('installed'); setDone(true); };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    // Give Chrome 800 ms to fire the event; if it hasn't, fall back to
    // the manual address-bar instructions.
    const t = setTimeout(() => {
      setPlatform((prev) => prev === 'loading' ? 'prompt-unavailable' : prev);
    }, 800);

    return () => {
      clearTimeout(t);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') { setPlatform('installed'); setDone(true); }
    } finally {
      setInstalling(false);
      setDeferred(null);
    }
  }

  // ── Installed state ────────────────────────────────────────────────────────
  if (platform === 'installed' || done) {
    if (variant === 'banner') return null; // hide banner once installed
    return (
      <Card variant={variant} onDismiss={onDismiss}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 flex-shrink-0">
            <CheckCircle2 size={18} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">App installed</p>
            <p className="text-xs text-gray-500 mt-0.5">StoryVenue is on your home screen. Open it from there for the best experience.</p>
          </div>
        </div>
      </Card>
    );
  }

  // ── iOS Chrome ───────────────────────────────────────────────────────────
  if (platform === 'ios-chrome') {
    return (
      <Card variant={variant} onDismiss={onDismiss}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 flex-shrink-0 mt-0.5">
            <Smartphone size={17} className="text-gray-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Add StoryVenue to your home screen</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              In Chrome, tap the{' '}
              <span className="inline-flex items-center gap-0.5 font-medium text-gray-700">
                <ShareGlyph /> Share
              </span>{' '}
              icon in the address bar (or tap <strong className="text-gray-700">⋮</strong> → <strong className="text-gray-700">Add to Home Screen</strong>). Once on your home screen, open it from the icon for push notifications and offline access.
            </p>
            <p className="text-xs text-gray-400 mt-1.5">
              Tip: for the best experience, <strong className="text-gray-500">open in Safari</strong> instead — Safari on iPhone has deeper PWA support.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // ── iOS Safari ────────────────────────────────────────────────────────────
  if (platform === 'ios-safari') {
    return (
      <Card variant={variant} onDismiss={onDismiss}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 flex-shrink-0 mt-0.5">
            <Smartphone size={17} className="text-gray-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Add StoryVenue to your home screen</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Tap the{' '}
              <span className="inline-flex items-center gap-0.5 font-medium text-gray-700">
                <ShareGlyph /> Share
              </span>{' '}
              button at the bottom of Safari, then tap <strong className="text-gray-700">&ldquo;Add to Home Screen&rdquo;</strong>. Once installed, open it from your home screen icon for the full app experience including push notifications.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // ── Chrome / Edge: prompt ready ───────────────────────────────────────────
  if (platform === 'prompt-ready') {
    return (
      <Card variant={variant} onDismiss={onDismiss}>
        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 flex-shrink-0">
            <Download size={17} className="text-gray-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">Install StoryVenue as an app</p>
            <p className="text-xs text-gray-500 mt-0.5">Faster access, works offline, and supports push notifications.</p>
          </div>
          <button
            type="button"
            onClick={() => void handleInstall()}
            disabled={installing}
            className="flex-shrink-0 rounded-xl px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
            style={{ backgroundColor: '#1b1b1b' }}
          >
            {installing ? 'Installing…' : 'Install app'}
          </button>
        </div>
      </Card>
    );
  }

  // ── Chrome / Edge: prompt not available (use address bar) ────────────────
  // This is the most common state on desktop Chrome after the first visit.
  return (
    <Card variant={variant} onDismiss={onDismiss}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 flex-shrink-0 mt-0.5">
          <Monitor size={17} className="text-gray-600" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Install StoryVenue as an app</p>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
            Look for the <InstallIcon /> install icon on the <strong className="text-gray-700">right side of your address bar</strong> in Chrome or Edge. Click it to install StoryVenue as a desktop app — faster access, works offline, and unlocks push notifications.
          </p>
          <p className="text-xs text-gray-400 mt-1.5">
            Don&rsquo;t see the icon?{' '}
            <span className="text-gray-500">Open Chrome menu (⋮) → <strong>Cast, save, and share</strong> → <strong>Install page as app</strong>.</span>
          </p>
        </div>
      </div>
    </Card>
  );
}

// ── Small wrappers ────────────────────────────────────────────────────────────

function Card({ variant, onDismiss, children }: { variant: 'card' | 'banner'; onDismiss?: () => void; children: React.ReactNode }) {
  if (variant === 'banner') {
    return (
      <div className="relative mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3.5 pr-10">
        {children}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-blue-100 hover:text-gray-600 transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
      {children}
    </div>
  );
}

function ShareGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-2px', color: '#3b82f6' }}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function InstallIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-2px', color: '#1b1b1b' }}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <polyline points="8 10 12 14 16 10" />
      <line x1="12" y1="7" x2="12" y2="14" />
    </svg>
  );
}
