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
  }, []);
  return null;
}
