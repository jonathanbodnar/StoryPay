'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isNativeApp, openExternalBrowser } from '@/lib/platform';

/**
 * `target="_blank"` links and `window.open()` calls are a completely
 * different code path from Capacitor's `allowNavigation` allowlist, and
 * neither native platform handles them the way the dashboard UI expects:
 *
 *   iOS     — WKUIDelegate.createWebViewWith unconditionally hands the URL to
 *             `UIApplication.shared.open(...)`, kicking the user out to
 *             Safari even for same-origin app.storyvenue.com links (e.g. the
 *             "View proposal" / "View invoice" / "View public page" buttons,
 *             which use target="_blank" purely so the *web* dashboard keeps
 *             its own tab open).
 *   Android — BridgeWebChromeClient never implements onCreateWindow, so
 *             window.open()/target="_blank" silently does nothing at all —
 *             a dead click, no popup, no browser.
 *
 * Neither platform gets this right by default, so intercept every
 * target="_blank" click and window.open() call ourselves while native:
 *   • same-origin (app.storyvenue.com) → client-side router.push, so it
 *     behaves exactly like a normal in-app link.
 *   • cross-origin (the public storyvenue.com listing, LunarPay, Calendly,
 *     Facebook Ads Manager, etc.) → Capacitor's Browser plugin, which opens
 *     a dismissible in-app browser sheet instead of leaving the app (iOS)
 *     or doing nothing (Android).
 */
export default function NativeExternalLinkGuard() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;

    function resolve(hrefLike: string): URL | null {
      try {
        return new URL(hrefLike, window.location.href);
      } catch {
        return null;
      }
    }

    function route(url: URL) {
      if (url.origin === window.location.origin) {
        router.push(`${url.pathname}${url.search}${url.hash}`);
      } else {
        void openExternalBrowser(url.href);
      }
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest('a[target="_blank"]') as HTMLAnchorElement | null;
      if (!anchor?.href) return;
      const url = resolve(anchor.href);
      if (!url) return;
      e.preventDefault();
      e.stopPropagation();
      route(url);
    }

    document.addEventListener('click', onClick, true);

    // Programmatic window.open() calls (admin impersonation links, etc.)
    // never fire a click event, so patch the API directly too.
    const originalOpen = window.open.bind(window);
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      if (!url) return originalOpen(url, target, features);
      const resolved = resolve(url instanceof URL ? url.href : url);
      if (!resolved) return originalOpen(url, target, features);
      route(resolved);
      return null;
    }) as typeof window.open;

    return () => {
      document.removeEventListener('click', onClick, true);
      window.open = originalOpen;
    };
  }, [router]);

  return null;
}
