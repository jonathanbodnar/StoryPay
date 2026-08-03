'use client';

/**
 * Registers the Capacitor native shell for OS push (APNs on iOS, FCM on
 * Android) once a logged-in dashboard session is mounted, and POSTs the device
 * token to /api/push/native-token so the server can target it (see
 * src/lib/native-push.ts + migration 186).
 *
 * No-op on the web — every path is gated behind `isNativeApp()`, so importing /
 * mounting this in the shared DashboardShell has zero effect in a browser.
 *
 * Tap-to-open: `pushNotificationActionPerformed` deep-links the webview to the
 * notification's `data.url` (e.g. /dashboard/conversations?thread=…). Because
 * the webview is same-origin with app.storyvenue.com, session cookies attach
 * and the target renders authenticated.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isNativeApp, getPlatform } from '@/lib/platform';

const TOKEN_KEY = 'sv_native_push_token';

/**
 * Run `fn` once the document is actually visible/foregrounded. Tapping a
 * notification while the app is backgrounded or the phone is locked delivers
 * `pushNotificationActionPerformed` slightly BEFORE WKWebView finishes
 * resuming; deferring until `visibilitychange` (with a small settle delay and
 * a safety-net timeout) makes the follow-up navigation reliable.
 */
function runWhenVisible(fn: () => void): void {
  if (typeof document === 'undefined') {
    fn();
    return;
  }
  if (document.visibilityState === 'visible') {
    // Even when already visible, the tap can land in the same transitional
    // instant the resume happens — a tiny delay avoids the race.
    window.setTimeout(fn, 150);
    return;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    document.removeEventListener('visibilitychange', onVisible);
    window.clearTimeout(safety);
    window.setTimeout(fn, 150);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') finish();
  };
  document.addEventListener('visibilitychange', onVisible);
  // Safety net: run anyway after 2s even if visibilitychange never fires.
  const safety = window.setTimeout(finish, 2000);
}

/**
 * Remove this device's token on logout so a signed-out phone stops receiving
 * pushes. Safe to call on the web (no-ops). Uses keepalive so the request
 * survives the navigation that logout triggers.
 */
export async function unregisterNativePush(): Promise<void> {
  if (!isNativeApp()) return;
  let token = '';
  try { token = window.localStorage.getItem(TOKEN_KEY) || ''; } catch { /* ignore */ }
  if (!token) return;
  try {
    await fetch('/api/push/native-token', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      keepalive: true,
    });
  } catch { /* best-effort */ }
  try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

/**
 * Fire the OS permission prompt and register for push. Called from an explicit
 * user action (the "Enable push notifications" toggle in Settings → Push
 * Notifications) — Apple's HIG wants the system prompt tied to user intent,
 * not auto-fired on app launch. Returns the resulting permission state so the
 * caller can reflect it in the UI.
 */
export async function requestNativePushPermission(): Promise<'granted' | 'denied'> {
  if (!isNativeApp()) return 'denied';
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    // On Android 13+ this also surfaces the POST_NOTIFICATIONS runtime prompt.
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive === 'granted') {
      await PushNotifications.register();
      return 'granted';
    }
    return 'denied';
  } catch {
    return 'denied';
  }
}

export default function NativePushRegistrar() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');

        const regListener = await PushNotifications.addListener('registration', (t: { value: string }) => {
          const token = t.value;
          try { window.localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
          void fetch('/api/push/native-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, platform: getPlatform() }),
          }).catch(() => undefined);
        });

        const errListener = await PushNotifications.addListener('registrationError', (err: unknown) => {
          console.warn('[native-push] registration error', err);
        });

        const actionListener = await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (action: { notification?: { data?: Record<string, unknown> } }) => {
            const raw = action.notification?.data?.url;
            const url = typeof raw === 'string' ? raw : '';
            // TEMP DIAGNOSTIC (see AGENTS notes): persist what we actually
            // received so it can be inspected after the fact via Safari Web
            // Inspector, without needing the inspector open at tap-time.
            // Remove once deep-link navigation is confirmed working.
            try {
              window.localStorage.setItem(
                'sv_last_push_action_debug',
                JSON.stringify({
                  at: new Date().toISOString(),
                  data: action.notification?.data ?? null,
                  url,
                  visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'n/a',
                }),
              );
            } catch { /* ignore */ }
            if (!url) return;
            // Normalise to a same-origin path so we stay inside the webview.
            let target = url;
            try {
              target = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
            } catch {
              /* use raw url */
            }
            // Navigate with the Next.js client router — NOT window.location.
            // In this Capacitor shell, full-page window.location navigations
            // are intercepted by the webview's navigation delegate and get
            // silently dropped (same root cause as the sign-in button once
            // opening Chrome, fixed via postAuthNavigate/router.push).
            runWhenVisible(() => {
              try {
                router.push(target);
              } catch {
                window.location.assign(target);
              }
            });
          },
        );

        // Contextual permissions: NEVER auto-prompt here. Only (re-)register to
        // refresh this device's token when the user has already granted push —
        // the prompt itself fires from the Push Notifications settings toggle
        // via requestNativePushPermission().
        const perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'granted') {
          await PushNotifications.register();
        }

        cleanup = () => {
          void regListener.remove();
          void errListener.remove();
          void actionListener.remove();
        };
      } catch (err) {
        console.warn('[native-push] setup failed', err);
      }
    })();

    return () => { cleanup?.(); };
  }, [router]);

  return null;
}
