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
import { isNativeApp, getPlatform } from '@/lib/platform';

const TOKEN_KEY = 'sv_native_push_token';

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

export default function NativePushRegistrar() {
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
            if (!url) return;
            try {
              // Normalise to a same-origin path so we stay inside the webview.
              const target = url.startsWith('http')
                ? new URL(url).pathname + new URL(url).search
                : url;
              window.location.assign(target);
            } catch {
              window.location.assign(url);
            }
          },
        );

        // Permission prompt (iOS) then OS registration. On Android 13+ this also
        // surfaces the POST_NOTIFICATIONS runtime prompt.
        const perm = await PushNotifications.requestPermissions();
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
  }, []);

  return null;
}
