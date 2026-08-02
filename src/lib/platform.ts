/**
 * Single source of truth for "are we running inside the Capacitor native
 * shell?" used by push registration (native APNs/FCM instead of web-push) and
 * the billing route-out (open Apple-risk purchase flows in the system browser).
 *
 * SSR-safe: every function guards `typeof window` so importing this from a
 * server component or during prerender never throws. On the server we always
 * report the web platform.
 */

import { Capacitor } from '@capacitor/core';

export type AppPlatform = 'ios' | 'android' | 'web';

/**
 * Production origin. Billing route-outs must use an ABSOLUTE https URL so the
 * system browser (Safari/Chrome) opens the real site rather than the webview's
 * internal scheme.
 */
export const APP_ORIGIN = 'https://app.storyvenue.com';

/** True only inside the Capacitor iOS/Android shell. False in any web browser. */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** 'ios' | 'android' when running natively; 'web' everywhere else. */
export function getPlatform(): AppPlatform {
  if (typeof window === 'undefined') return 'web';
  try {
    const p = Capacitor.getPlatform();
    if (p === 'ios' || p === 'android') return p;
    return 'web';
  } catch {
    return 'web';
  }
}

/**
 * Build an absolute production URL from a path or absolute URL. Used so
 * billing route-outs always target the live site regardless of what origin the
 * webview reports.
 */
export function toAbsoluteAppUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${APP_ORIGIN}${path}`;
}

/**
 * Navigate to a same-origin path after an action like sign-in. On the web this
 * is a plain `window.location.href` full reload (needed so server components
 * re-run with the fresh session cookie). On native, a full top-level reload
 * can get intercepted by the WKWebView navigation delegate and handed off to
 * the SYSTEM browser instead of staying in the app's webview — so instead we
 * do a client-side route change via the Next.js router, which never triggers
 * that top-level-navigation path. The freshly-set cookie is already in the
 * webview's cookie jar (set by the preceding fetch response), so the RSC
 * request the router makes still authenticates correctly.
 */
export function postAuthNavigate(router: { push: (href: string) => void }, target: string): void {
  const isAbsolute = /^https?:\/\//i.test(target);
  if (isNativeApp() && !isAbsolute) {
    router.push(target);
    return;
  }
  if (typeof window !== 'undefined') window.location.href = target;
}

/**
 * Open a URL in the EXTERNAL system browser when running natively (so Apple /
 * Google never see an in-app purchase flow), or fall back to normal in-webview
 * navigation on the web. Callers should only reach the native branch behind an
 * `isNativeApp()` check, but this helper is defensive either way.
 *
 * Returns true when it handled the navigation natively (so the caller can
 * `preventDefault()` on a Link/anchor), false when the web path should proceed.
 */
export async function openExternalBrowser(pathOrUrl: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  const url = toAbsoluteAppUrl(pathOrUrl);
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
    return true;
  } catch {
    // Last-ditch fallback: hard-navigate. Better a working link than a dead
    // button if the Browser plugin ever fails to load.
    if (typeof window !== 'undefined') window.location.href = url;
    return true;
  }
}
