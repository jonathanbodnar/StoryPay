'use client';

/**
 * Push notification opt-in UI, rendered at the top of
 * Settings → Notifications. Handles:
 *
 *   - Detecting browser support (`PushManager`, `serviceWorker`,
 *     `Notification`). Unsupported browsers see an inline note instead of
 *     a broken toggle.
 *   - Surfacing the iOS-installed-PWA caveat (push only works on iOS after
 *     the user installs to home screen and reopens from the icon).
 *   - Subscribing / unsubscribing through the SW push manager, with the
 *     /api/push/subscribe and /api/push/unsubscribe routes.
 *   - Rendering per-scenario toggles (payment_received, proposal_signed,
 *     new_lead, new_message, ai_handoff …) backed by the same
 *     `venue_notifications.settings` JSON bag as email/SMS toggles.
 *   - Sending a one-tap test push through /api/push/test.
 *
 * Permissions API rules we have to follow:
 *   - `Notification.requestPermission()` must be called from a user gesture
 *     (the button click). Calling it from a useEffect would silently fail
 *     or be ignored.
 *   - `pushManager.subscribe()` similarly requires a user gesture in
 *     Safari/iOS.
 *   - Both calls are awaited synchronously inside the click handler.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, CheckCircle2, AlertTriangle, Send, Smartphone } from 'lucide-react';

// ── Per-scenario toggle definition ──────────────────────────────────────────
// Mirrors SCENARIO_META in src/lib/owner-notifications.ts. Add/remove rows
// here when adding new push categories so the Settings UI stays in sync.
const SCENARIO_TOGGLES: { key: string; label: string; description: string; defaultOn: boolean }[] = [
  { key: 'push_new_lead',             label: 'New lead',              description: 'Someone enquires through your listing or website form.', defaultOn: true },
  { key: 'push_new_message',          label: 'New message',           description: 'A contact replies to a conversation.',                   defaultOn: true },
  { key: 'push_ai_handoff',           label: 'AI Concierge handoff',  description: 'The AI hands a conversation back to you.',               defaultOn: true },
  { key: 'push_proposal_signed',      label: 'Proposal signed',       description: 'A customer signs a proposal you sent.',                  defaultOn: true },
  { key: 'push_document_viewed',      label: 'Document viewed',       description: 'A customer opens a proposal or invoice you sent.',       defaultOn: false },
  { key: 'push_payment_received',     label: 'Payment received',      description: 'Any successful payment from a customer.',                defaultOn: true },
  { key: 'push_payment_failed',       label: 'Payment failed',        description: 'A charge attempt declines.',                             defaultOn: true },
  { key: 'push_high_value_payment',   label: 'High-value payment',    description: 'Single payment over $1,000.',                            defaultOn: true },
  { key: 'push_invoice_paid',         label: 'Invoice paid',          description: 'A standalone invoice is paid in full.',                  defaultOn: true },
  { key: 'push_refund_issued',        label: 'Refund issued',         description: 'A refund is processed.',                                 defaultOn: true },
  { key: 'push_subscription_created', label: 'New subscription',      description: 'A recurring plan starts.',                               defaultOn: false },
  { key: 'push_subscription_cancelled', label: 'Subscription cancelled', description: 'A recurring plan ends.',                              defaultOn: false },
  { key: 'push_new_customer',         label: 'New customer',          description: 'A new customer record is created.',                      defaultOn: false },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
/** Returns an ArrayBuffer (not Uint8Array) so it satisfies the `BufferSource`
 *  type that `pushManager.subscribe({ applicationServerKey })` requires.
 *  TS 5.7+ tightened `Uint8Array<ArrayBufferLike>` so a bare Uint8Array no
 *  longer implicitly converts to BufferSource. ArrayBuffer is BufferSource
 *  directly, sidestepping the variance complaint. */
function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && 'ontouchend' in document)
  );
}

type Status = 'loading' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'server-disabled' | 'ios-needs-install';

// ── Component ───────────────────────────────────────────────────────────────
export default function PushNotificationManager() {
  const [status, setStatus]       = useState<Status>('loading');
  const [busy, setBusy]           = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [settings, setSettings]   = useState<Record<string, boolean>>({});
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [testing, setTesting]     = useState(false);
  const [testResult, setTestResult] = useState<{ sent: number; pruned: number; failed: number } | null>(null);
  const [error, setError]         = useState<string | null>(null);

  // ── Boot: determine support + current subscription ────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (typeof window === 'undefined') return;

      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setStatus('unsupported');
        return;
      }

      // Special-case iOS: push requires the PWA to be installed AND opened
      // from the home screen. Calling Notification.requestPermission from a
      // regular Safari tab on iOS throws.
      if (isIOS() && !isStandalone()) {
        if (!cancelled) setStatus('ios-needs-install');
        return;
      }

      // Check whether VAPID is configured on the server before showing any
      // controls — avoids dead-end states where the user clicks Enable and
      // the subscribe call 503s.
      try {
        const res = await fetch('/api/push/vapid-public-key');
        if (res.status === 503) {
          if (!cancelled) setStatus('server-disabled');
          return;
        }
        if (!res.ok) throw new Error(`vapid-public-key ${res.status}`);
      } catch {
        if (!cancelled) setStatus('server-disabled');
        return;
      }

      if (Notification.permission === 'denied') {
        if (!cancelled) setStatus('denied');
        return;
      }

      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) {
          setSubscription(existing);
          setStatus(existing ? 'subscribed' : 'unsubscribed');
        }
      } catch (err) {
        console.warn('[push] failed to read current subscription', err);
        if (!cancelled) setStatus('unsubscribed');
      }

      // Load saved settings bag (shared with email/SMS toggles).
      try {
        const res = await fetch('/api/notifications', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as Record<string, boolean>;
          if (!cancelled) setSettings(data);
        }
      } catch {
        /* non-fatal — UI just falls back to defaults */
      }
    }

    void boot();
    return () => { cancelled = true; };
  }, []);

  // ── Master enable / disable ───────────────────────────────────────────────
  const enable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      // Permission MUST be requested from a user gesture, which is why this
      // helper lives inside the click handler.
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStatus(perm === 'denied' ? 'denied' : 'unsubscribed');
        return;
      }

      const keyRes = await fetch('/api/push/vapid-public-key');
      if (!keyRes.ok) throw new Error('Server has no VAPID key configured.');
      const { publicKey } = (await keyRes.json()) as { publicKey: string };

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
        // Roll back the browser-side subscription so we don't end up with a
        // dangling subscription that has no server counterpart.
        await sub.unsubscribe().catch(() => undefined);
        throw new Error('Could not save the subscription on the server.');
      }

      // Master push toggle defaults to off in DEFAULT_NOTIFICATIONS — flip
      // it on now that the user has actively opted in.
      await persistSettings({ ...settings, push_enabled: true });
      setSettings((prev) => ({ ...prev, push_enabled: true }));
      setSubscription(sub);
      setStatus('subscribed');
    } catch (err) {
      console.error('[push] enable failed', err);
      setError(err instanceof Error ? err.message : 'Failed to enable push notifications.');
    } finally {
      setBusy(false);
    }
  }, [settings]);

  const disable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (subscription) {
        const endpoint = subscription.endpoint;
        try { await subscription.unsubscribe(); } catch { /* may fail in private mode */ }
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        }).catch(() => undefined);
      }
      await persistSettings({ ...settings, push_enabled: false });
      setSettings((prev) => ({ ...prev, push_enabled: false }));
      setSubscription(null);
      setStatus('unsubscribed');
    } finally {
      setBusy(false);
    }
  }, [subscription, settings]);

  // ── Per-scenario toggle persistence ──────────────────────────────────────
  async function persistSettings(next: Record<string, boolean>) {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleScenario(key: string, defaultOn: boolean) {
    setSettings((prev) => {
      const current = prev[key] === undefined ? defaultOn : prev[key];
      const next = { ...prev, [key]: !current };
      void persistSettings(next);
      return next;
    });
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as { sent: number; pruned: number; failed: number };
        setTestResult(data);
        setTimeout(() => setTestResult(null), 5000);
      }
    } finally {
      setTesting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 mb-5 flex items-center gap-2 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" />
        Checking push notification support…
      </div>
    );
  }

  if (status === 'unsupported') {
    return (
      <InfoCard
        icon={<BellOff size={16} className="text-gray-400" />}
        title="Push notifications not supported"
        body="This browser doesn't support web push. Try Chrome, Edge, Firefox, or Safari 16.4+."
      />
    );
  }

  if (status === 'server-disabled') {
    return (
      <InfoCard
        icon={<AlertTriangle size={16} className="text-amber-500" />}
        title="Push notifications aren't configured yet"
        body="An administrator needs to add VAPID keys to the server before push can be enabled. Generate them with `npx web-push generate-vapid-keys` and set NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY on Railway."
      />
    );
  }

  if (status === 'ios-needs-install') {
    return (
      <InfoCard
        icon={<Smartphone size={16} className="text-gray-700" />}
        title="Install StoryVenue to enable push on iOS"
        body="On iPhone and iPad, push notifications only work after you add StoryVenue to your home screen. Tap the Share button in Safari, then 'Add to Home Screen'. Re-open StoryVenue from the home-screen icon and come back to this page."
      />
    );
  }

  if (status === 'denied') {
    return (
      <InfoCard
        icon={<BellOff size={16} className="text-red-500" />}
        title="Push notifications are blocked"
        body="You denied notification permission for this site. Re-enable it in your browser's site settings, then refresh this page."
      />
    );
  }

  const isOn = status === 'subscribed';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0 ${isOn ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
            {isOn ? <Bell size={16} /> : <BellOff size={16} />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Push notifications</p>
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              {isOn ? 'Enabled on this device. Tap Send Test to verify.' : 'Get instant alerts on this device for the events you care about.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isOn && (
            <button
              type="button"
              onClick={() => void sendTest()}
              disabled={testing}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {testing ? 'Sending…' : 'Send test'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void (isOn ? disable() : enable())}
            disabled={busy}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-60 ${
              isOn
                ? 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                : 'text-white hover:opacity-90'
            }`}
            style={isOn ? undefined : { backgroundColor: '#1b1b1b' }}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}
            {busy ? 'Working…' : isOn ? 'Disable on this device' : 'Enable push notifications'}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-5 py-2 text-xs text-red-500 bg-red-50 border-b border-red-100 flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {testResult && (
        <div className="px-5 py-2 text-xs text-emerald-700 bg-emerald-50 border-b border-emerald-100 flex items-center gap-1.5">
          <CheckCircle2 size={12} />
          Sent to {testResult.sent} device{testResult.sent === 1 ? '' : 's'}
          {testResult.pruned > 0 && ` (pruned ${testResult.pruned} expired)`}
          {testResult.failed > 0 && ` — ${testResult.failed} failed`}
        </div>
      )}

      {isOn && (
        <div className="divide-y divide-gray-50">
          <div className="px-5 py-3 text-[11px] uppercase tracking-wider font-semibold text-gray-400 bg-gray-50/40 flex items-center justify-between">
            <span>Send a push when…</span>
            {saving && <Loader2 size={11} className="animate-spin text-gray-300" />}
            {saved && !saving && <span className="text-emerald-500 normal-case tracking-normal font-medium">Saved</span>}
          </div>
          {SCENARIO_TOGGLES.map((row) => {
            const current = settings[row.key] === undefined ? row.defaultOn : settings[row.key];
            return (
              <div key={row.key} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50/40">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{row.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{row.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={current}
                  onClick={() => toggleScenario(row.key, row.defaultOn)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                    current ? 'bg-emerald-500' : 'bg-gray-200'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full border border-gray-200 bg-white transition-transform ${
                    current ? 'translate-x-[18px]' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Inline info card (unsupported / denied / iOS / server-disabled) ─────────
function InfoCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 mb-5 flex items-start gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gray-50 flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
