'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { isNativeApp } from '@/lib/platform';
import { requestNativePushPermission } from '@/components/NativePushRegistrar';

// ── Native app toggles — financial scenarios excluded for App Store compliance ─
const NATIVE_TOGGLES = [
  { key: 'push_new_lead',    label: 'New lead',             description: 'Someone enquires about your venue.',    defaultOn: true },
  { key: 'push_new_message', label: 'New message',          description: 'A contact sends you a reply.',          defaultOn: true },
  { key: 'push_ai_handoff',  label: 'AI Concierge handoff', description: 'The AI hands a conversation to you.',   defaultOn: true },
];

// Financial scenario keys disabled on native to satisfy App Store guidelines.
const NATIVE_DISABLED_FINANCIAL_KEYS: Record<string, boolean> = {
  push_payment_received:      false,
  push_payment_failed:        false,
  push_high_value_payment:    false,
  push_invoice_paid:          false,
  push_refund_issued:         false,
  push_subscription_created:  false,
  push_subscription_cancelled: false,
};

/**
 * Push Notifications settings — NATIVE APP ONLY.
 *
 * Web push (VAPID/PWA) is on hold for now — the native iOS/Android apps are
 * the intended home for real-time alerts on mobile, and email + SMS
 * (Settings -> Notifications) already cover the web experience. This page
 * still exists so the native app shell can drive the one OS-level push
 * permission prompt; a web visitor who lands here gets redirected to the
 * unified Notifications page instead of a dead install wizard.
 */
export default function PushNotificationsClientPage() {
  const router = useRouter();
  const [settings,      setSettings]      = useState<Record<string, boolean>>({});
  const [saving,        setSaving]        = useState(false);
  // Native: OS notification permission was denied — show how to fix it.
  const [nativePermDenied, setNativePermDenied] = useState(false);
  // Native: whether THIS device's OS notification permission is granted.
  // The master toggle requires it — push_enabled alone is a venue-wide flag,
  // so without this check a fresh device (or first login) would show the
  // toggle ON even though this phone never went through the enable flow.
  const [nativePermGranted, setNativePermGranted] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!isNativeApp()) {
      router.replace('/dashboard/settings/notifications');
      return;
    }

    fetch('/api/notifications', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setSettings(d as Record<string, boolean>); })
      .catch(() => {});

    void (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const perm = await PushNotifications.checkPermissions();
        setNativePermGranted(perm.receive === 'granted');
      } catch { /* ignore */ }
    })();
  }, [router]);

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

  if (!isNativeApp()) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={20} className="animate-spin text-gray-300" />
      </div>
    );
  }

  // ON only when the venue-wide flag is set AND this device's OS permission
  // is granted — a fresh device / first login starts OFF until the user
  // explicitly flips the switch (which fires the OS prompt).
  const nativeEnabled = settings.push_enabled === true && nativePermGranted;

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="font-heading text-2xl text-gray-900">Push Notifications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Get instant alerts for new leads, messages, and more right on your phone.
        </p>
      </div>

      {/* Master toggle */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mb-4">
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">Enable push notifications</p>
            <p className="text-xs text-gray-400 mt-0.5">Turn off to stop all alerts on this device.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={nativeEnabled}
            onClick={async () => {
              const turningOn = !nativeEnabled;
              if (turningOn) {
                // Contextual OS prompt: only fires here, on explicit user
                // intent — never automatically on app launch.
                const perm = await requestNativePushPermission();
                if (perm !== 'granted') {
                  setNativePermDenied(true);
                  return;
                }
                setNativePermDenied(false);
                setNativePermGranted(true);
              }
              const next = {
                ...settings,
                push_enabled: turningOn,
                // Keep financial scenarios disabled on native (App Store compliance).
                ...NATIVE_DISABLED_FINANCIAL_KEYS,
              };
              setSettings(next);
              setSaving(true);
              fetch('/api/notifications', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(next),
              }).finally(() => setSaving(false));
            }}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${nativeEnabled ? 'bg-emerald-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${nativeEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {nativePermDenied && (
          <div className="border-t border-gray-100 bg-amber-50 px-5 py-3">
            <p className="text-xs text-amber-800">
              Notifications are blocked for StoryVenue. Allow them in your phone&apos;s
              Settings &rarr; Notifications &rarr; StoryVenue, then flip this switch again.
            </p>
          </div>
        )}
      </div>

      {/* Per-scenario toggles */}
      {nativeEnabled && (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Alert types</p>
          </div>
          <div className="divide-y divide-gray-50">
            {NATIVE_TOGGLES.map((row) => {
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
            <div className="flex items-center gap-1.5 text-xs text-gray-400 px-5 py-3">
              <RefreshCw size={11} className="animate-spin" /> Saving…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
