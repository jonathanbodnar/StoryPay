'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, Bell, BellOff, Loader2, Send, Smartphone,
  ChevronRight, AlertTriangle, Monitor, RefreshCw,
} from 'lucide-react';

// ── Platform detection ────────────────────────────────────────────────────────
function getUA() { return typeof window !== 'undefined' ? window.navigator.userAgent : ''; }
function isIOS()        { const ua = getUA(); return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document); }
function isIOSChrome()  { return /CriOS/.test(getUA()); }
function isIOSSafari()  { const ua = getUA(); return isIOS() && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Android/.test(ua); }
function isAndroid()    { return /Android/.test(getUA()); }
function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

type Platform = 'loading' | 'ios-safari' | 'ios-chrome' | 'android' | 'desktop';

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'loading';
  if (isIOSChrome()) return 'ios-chrome';
  if (isIOS())       return 'ios-safari';
  if (isAndroid())   return 'android';
  return 'desktop';
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// ── Per-scenario toggles (mirrored from PushNotificationManager) ─────────────
const TOGGLES = [
  { key: 'push_new_lead',             label: 'New lead',              description: 'Someone enquires about your venue.',       defaultOn: true },
  { key: 'push_new_message',          label: 'New message',           description: 'A contact sends you a reply.',             defaultOn: true },
  { key: 'push_ai_handoff',           label: 'AI Concierge handoff',  description: 'The AI hands a conversation to you.',      defaultOn: true },
  { key: 'push_proposal_signed',      label: 'Proposal signed',       description: 'A customer signs a proposal.',             defaultOn: true },
  { key: 'push_payment_received',     label: 'Payment received',      description: 'Any successful payment comes in.',         defaultOn: true },
  { key: 'push_payment_failed',       label: 'Payment failed',        description: 'A charge attempt fails.',                  defaultOn: true },
  { key: 'push_high_value_payment',   label: 'High-value payment',    description: 'A single payment over $1,000.',            defaultOn: true },
  { key: 'push_invoice_paid',         label: 'Invoice paid',          description: 'A standalone invoice is paid.',            defaultOn: true },
  { key: 'push_document_viewed',      label: 'Document opened',       description: 'A customer opens a proposal you sent.',   defaultOn: false },
  { key: 'push_refund_issued',        label: 'Refund issued',         description: 'A refund is processed.',                   defaultOn: true },
  { key: 'push_subscription_created', label: 'New subscription',      description: 'A recurring payment plan starts.',         defaultOn: false },
  { key: 'push_subscription_cancelled', label: 'Subscription cancelled', description: 'A recurring plan ends.',               defaultOn: false },
  { key: 'push_new_customer',         label: 'New contact',           description: 'A new customer record is created.',        defaultOn: false },
];

function urlBase64ToArrayBuffer(b64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PushNotificationsClientPage() {
  const [platform,      setPlatform]      = useState<Platform>('loading');
  const [installed,     setInstalled]     = useState(false);
  const [pushEnabled,   setPushEnabled]   = useState(false);
  const [deferred,      setDeferred]      = useState<BeforeInstallPromptEvent | null>(null);
  const [installing,    setInstalling]    = useState(false);
  const [enabling,      setEnabling]      = useState(false);
  const [settings,      setSettings]      = useState<Record<string, boolean>>({});
  const [saving,        setSaving]        = useState(false);
  const [subscription,  setSubscription]  = useState<PushSubscription | null>(null);
  const [testing,       setTesting]       = useState(false);
  const [testResult,    setTestResult]    = useState<{ sent: number } | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [vapidMissing,  setVapidMissing]  = useState(false);

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    setPlatform(detectPlatform());
    setInstalled(isStandalone());

    // Check VAPID config
    fetch('/api/push/vapid-public-key').then((r) => {
      if (r.status === 503) setVapidMissing(true);
    }).catch(() => setVapidMissing(true));

    // Check existing push subscription
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription()
      ).then((sub) => {
        setSubscription(sub);
        if (sub) setPushEnabled(true);
      }).catch(() => {});
    }

    // Load saved notification settings
    fetch('/api/notifications', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setSettings(d as Record<string, boolean>); })
      .catch(() => {});

    // Capture install prompt
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // ── Install ───────────────────────────────────────────────────────────────
  const handleInstall = useCallback(async () => {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') setInstalled(true);
    } finally {
      setInstalling(false);
      setDeferred(null);
    }
  }, [deferred]);

  // ── Enable push ───────────────────────────────────────────────────────────
  const handleEnable = useCallback(async () => {
    setError(null);
    setEnabling(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setError(perm === 'denied'
          ? 'Notifications are blocked. Go to your browser settings to allow them for this site, then try again.'
          : 'Permission not granted. Please try again.');
        return;
      }
      const keyRes = await fetch('/api/push/vapid-public-key');
      if (!keyRes.ok) throw new Error('Server not configured for push yet.');
      const { publicKey } = await keyRes.json() as { publicKey: string };

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(publicKey),
      });

      const saveRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!saveRes.ok) {
        await sub.unsubscribe().catch(() => undefined);
        throw new Error('Could not save subscription. Please try again.');
      }

      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, push_enabled: true }),
      });
      setSettings((p) => ({ ...p, push_enabled: true }));
      setSubscription(sub);
      setPushEnabled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setEnabling(false);
    }
  }, [settings]);

  // ── Disable push ──────────────────────────────────────────────────────────
  const handleDisable = useCallback(async () => {
    if (subscription) {
      try { await subscription.unsubscribe(); } catch { /* ok */ }
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => undefined);
    }
    await fetch('/api/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, push_enabled: false }),
    });
    setSettings((p) => ({ ...p, push_enabled: false }));
    setSubscription(null);
    setPushEnabled(false);
  }, [subscription, settings]);

  // ── Toggle scenario ───────────────────────────────────────────────────────
  function toggleScenario(key: string, defaultOn: boolean) {
    setSettings((prev) => {
      const current = prev[key] === undefined ? defaultOn : prev[key];
      const next = { ...prev, [key]: !current };
      setSaving(true);
      fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).finally(() => setSaving(false));
      return next;
    });
  }

  // ── Send test ─────────────────────────────────────────────────────────────
  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch('/api/push/test', { method: 'POST' }).catch(() => null);
    if (res?.ok) {
      const d = await res.json() as { sent: number };
      setTestResult(d);
      setTimeout(() => setTestResult(null), 5000);
    }
    setTesting(false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const pl = platform;

  // Whether the install step is complete — either browser reports standalone
  // or user confirmed install during this session.
  const installDone = installed;

  // Whether Step 1 (install) is skippable for this platform.
  // Desktop and Android Chrome users get push without installing first.
  const installRequired = pl === 'ios-safari' || pl === 'ios-chrome';

  // iOS with push blocked warning (push needs standalone on iOS).
  const iosNeedsInstall = installRequired && !installDone && pushEnabled;

  return (
    <div className="max-w-2xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="font-heading text-2xl text-gray-900">Push Notifications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Get instant alerts on this device — new leads, payments, messages, and more. Takes about 30 seconds to set up.
        </p>
      </div>

      {/* Server not configured */}
      {vapidMissing && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3 mb-6">
          <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Not configured yet</p>
            <p className="text-xs text-amber-700 mt-0.5">An admin needs to add VAPID keys to the server. Email us at clients@storyvenuemarketing.com and we&apos;ll get this set up for you.</p>
          </div>
        </div>
      )}

      {/* ── Setup steps ── */}
      <div className="space-y-4">

        {/* STEP 1: Install the app */}
        <StepCard
          number={1}
          title="Install the StoryVenue app on this device"
          done={installDone}
          // Skip showing step 1 for desktop/android where install isn't required for push
          skip={!installRequired && installDone === false}
          skipLabel="Optional on this device"
        >
          {installDone ? (
            <p className="text-sm text-gray-500">StoryVenue is installed on your home screen.</p>
          ) : pl === 'ios-safari' ? (
            <IOSSafariInstallGuide />
          ) : pl === 'ios-chrome' ? (
            <IOSChromeInstallGuide />
          ) : deferred ? (
            // Android or desktop Chrome — we have the prompt ready
            <div className="space-y-3">
              <p className="text-sm text-gray-600">Tap the button below and Chrome will ask you to install StoryVenue as an app on your device.</p>
              <button
                type="button"
                onClick={() => void handleInstall()}
                disabled={installing}
                className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
                style={{ backgroundColor: '#1b1b1b' }}
              >
                {installing ? <Loader2 size={15} className="animate-spin" /> : <Smartphone size={15} />}
                {installing ? 'Installing…' : 'Install StoryVenue app'}
              </button>
              <p className="text-xs text-gray-400">A popup will appear asking you to confirm — tap <strong className="text-gray-600">Install</strong>.</p>
            </div>
          ) : pl === 'android' || pl === 'desktop' ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Look for the <strong className="text-gray-800">install icon</strong> (⊕) on the right side of your browser&apos;s address bar and click it.</p>
              <p className="text-xs text-gray-400">Or open the browser menu (⋮) → <strong className="text-gray-600">Install StoryVenue</strong> or <strong className="text-gray-600">Add to Home Screen</strong>.</p>
              <button
                type="button"
                onClick={() => setInstalled(true)}
                className="text-xs text-blue-600 hover:underline"
              >
                I&apos;ve already installed it →
              </button>
            </div>
          ) : (
            <div className="flex justify-center py-4">
              <Loader2 size={18} className="animate-spin text-gray-300" />
            </div>
          )}
        </StepCard>

        {/* STEP 2: Enable notifications */}
        <StepCard
          number={2}
          title="Turn on notifications for this device"
          done={pushEnabled}
          locked={installRequired && !installDone && !pushEnabled}
          lockedReason="Complete Step 1 first"
        >
          {pushEnabled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 size={15} />
                <span>Push notifications are <strong>on</strong> for this device.</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void sendTest()}
                  disabled={testing}
                  className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {testing ? 'Sending…' : 'Send a test notification'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisable()}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  Turn off
                </button>
              </div>
              {testResult && (
                <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                  <CheckCircle2 size={12} />
                  Sent! Check your notifications — you should see it now.
                  {testResult.sent === 0 && ' (0 devices reached — make sure notifications are allowed in your phone settings)'}
                </p>
              )}
              {iosNeedsInstall && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2">
                  On iPhone, push only works when StoryVenue is opened from your home screen icon. Complete Step 1 to receive notifications.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Tap the button below. Your browser will ask for permission — tap <strong className="text-gray-800">Allow</strong>.
              </p>
              {error && (
                <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-xs text-red-600 flex items-start gap-2">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => void handleEnable()}
                disabled={enabling || vapidMissing || (installRequired && !installDone)}
                className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
                style={{ backgroundColor: '#1b1b1b' }}
              >
                {enabling ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />}
                {enabling ? 'Turning on…' : 'Turn on push notifications'}
              </button>
              {pl === 'ios-safari' && (
                <p className="text-xs text-gray-400">
                  On iPhone, this button only works after you install StoryVenue from Step 1 and open it from your home screen.
                </p>
              )}
            </div>
          )}
        </StepCard>

        {/* STEP 3: Choose what to be notified about */}
        {pushEnabled && (
          <StepCard number={3} title="Choose what you want to be notified about" done={false} noCheck>
            <div className="divide-y divide-gray-50 -mx-5">
              {TOGGLES.map((row) => {
                const current = settings[row.key] === undefined ? row.defaultOn : settings[row.key];
                return (
                  <div key={row.key} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50/60">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 leading-tight">{row.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{row.description}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={current}
                      onClick={() => toggleScenario(row.key, row.defaultOn)}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${current ? 'bg-emerald-500' : 'bg-gray-200'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${current ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
            {saving && (
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-3">
                <RefreshCw size={11} className="animate-spin" /> Saving…
              </div>
            )}
          </StepCard>
        )}
      </div>

      {/* Footnote */}
      <p className="text-xs text-gray-400 mt-6 leading-relaxed">
        Notifications are <strong className="text-gray-500">per device</strong> — repeat this setup on each phone or computer you want to receive alerts on. You can turn off anytime from Step 2 above.
      </p>
    </div>
  );
}

// ── Step card wrapper ─────────────────────────────────────────────────────────
function StepCard({
  number, title, done, noCheck, skip, skipLabel, locked, lockedReason, children,
}: {
  number: number;
  title: string;
  done: boolean;
  noCheck?: boolean;
  skip?: boolean;
  skipLabel?: string;
  locked?: boolean;
  lockedReason?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border bg-white overflow-hidden transition-colors ${
      done && !noCheck ? 'border-emerald-200' : 'border-gray-200'
    } ${locked ? 'opacity-50' : ''}`}>
      <div className={`px-5 py-4 border-b flex items-center gap-3 ${
        done && !noCheck ? 'border-emerald-100 bg-emerald-50/40' : 'border-gray-100'
      }`}>
        {/* Step bubble */}
        {done && !noCheck ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 flex-shrink-0">
            <CheckCircle2 size={15} className="text-white" />
          </div>
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-800 flex-shrink-0">
            <span className="text-xs font-bold text-white">{number}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${done && !noCheck ? 'text-emerald-800' : 'text-gray-900'}`}>
            {title}
          </p>
          {skip && skipLabel && (
            <p className="text-xs text-gray-400 mt-0.5">{skipLabel}</p>
          )}
          {locked && lockedReason && (
            <p className="text-xs text-gray-400 mt-0.5">🔒 {lockedReason}</p>
          )}
        </div>
        {done && !noCheck && (
          <span className="text-xs font-semibold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full flex-shrink-0">Done</span>
        )}
      </div>
      <div className="px-5 py-4">
        {children}
      </div>
    </div>
  );
}

// ── iOS Safari step-by-step ───────────────────────────────────────────────────
function IOSSafariInstallGuide() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">Follow these steps in <strong className="text-gray-800">Safari</strong> on your iPhone:</p>
      <div className="space-y-3">
        <InstallStep n={1} icon="📤">
          Tap the <strong>Share button</strong> at the bottom of Safari — it looks like a box with an arrow pointing up.
        </InstallStep>
        <InstallStep n={2} icon="📲">
          Scroll down in the menu and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
        </InstallStep>
        <InstallStep n={3} icon="✅">
          Tap <strong>Add</strong> in the top-right corner. StoryVenue will appear on your home screen.
        </InstallStep>
        <InstallStep n={4} icon="🏠">
          <strong>Close Safari</strong> and open StoryVenue from your home screen icon. Then come back to this page.
        </InstallStep>
      </div>
      <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700">
        <strong>Important:</strong> You must be using <strong>Safari</strong> for this to work. If you&apos;re in Chrome or another browser, open this page in Safari first.
      </div>
    </div>
  );
}

// ── iOS Chrome step-by-step ───────────────────────────────────────────────────
function IOSChromeInstallGuide() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">You&apos;re using <strong className="text-gray-800">Chrome on iPhone</strong>. Here&apos;s how to add to your home screen:</p>
      <div className="space-y-3">
        <InstallStep n={1} icon="⋮">
          Tap the <strong>Share icon</strong> (box with arrow) in Chrome&apos;s address bar at the top.
        </InstallStep>
        <InstallStep n={2} icon="📲">
          Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
        </InstallStep>
        <InstallStep n={3} icon="✅">
          Tap <strong>Add</strong>. StoryVenue will appear on your home screen.
        </InstallStep>
      </div>
      <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-700">
        <strong>Tip:</strong> For push notifications to work on iPhone, try opening this page in <strong>Safari</strong> instead of Chrome — Safari has better PWA support on iOS.
      </div>
    </div>
  );
}

function InstallStep({ n, icon, children }: { n: number; icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-gray-100 flex-shrink-0 text-base mt-0.5">
        {icon}
      </div>
      <div className="flex-1 pt-0.5">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mr-1.5">Step {n}</span>
        <span className="text-sm text-gray-700">{children}</span>
      </div>
    </div>
  );
}

// Suppress unused import warnings for icons used implicitly
void Monitor;
void BellOff;
void ChevronRight;
