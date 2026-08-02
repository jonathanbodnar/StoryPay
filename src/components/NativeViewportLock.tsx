'use client';

import { useEffect } from 'react';
import { isNativeApp } from '@/lib/platform';

/**
 * Locks the viewport scale inside the native app shell.
 *
 * Without this, iOS zooms the whole WebView in when a sub-16px input is
 * focused (login form) and zooms out on double-taps ("smart zoom") — which
 * made pages randomly render narrower/wider than the device width. Native
 * apps never scale, so pin the WebView to 1:1. Mobile web / PWA users are
 * unaffected (pinch-zoom accessibility preserved in real browsers).
 */
export default function NativeViewportLock() {
  useEffect(() => {
    if (!isNativeApp()) return;
    let meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.content =
      'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

    // Belt-and-suspenders: WKWebView's pinch-zoom gesture recognizer can
    // ignore the meta tag above, and `user-scalable=no` doesn't stop the
    // "zoom to legible size" that fires when a sub-16px input gains focus.
    // Once either happens, the zoom persists across Next.js client-side
    // route changes (there's no full page reload to reset it), so every
    // later page appears zoomed-in/narrower until the user pinches back
    // out. Block the native gesture directly as a second line of defense
    // (globals.css floors input font-size at 16px as the primary fix).
    document.documentElement.classList.add('native-app-shell');
    const preventGesture = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', preventGesture);
    document.addEventListener('gesturechange', preventGesture);
    return () => {
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
    };
  }, []);
  return null;
}
