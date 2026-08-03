'use client';

/**
 * TEMPORARY on-screen debug overlay for diagnosing why tapping a push
 * notification isn't deep-linking to the right conversation thread.
 *
 * Reads the two localStorage breadcrumbs written by NativePushRegistrar.tsx
 * (what the tap handler received) and conversations/page.tsx (what the page
 * saw in its URL on mount), and renders them directly on screen — no cable,
 * no Safari Web Inspector, no Railway dashboard required. Just tap the
 * floating bug button after tapping a notification and screenshot it.
 *
 * Native-app only. Remove this file + its mount in layout.tsx once the
 * deep-link issue is confirmed fixed.
 */

import { useEffect, useState } from 'react';
import { isNativeApp } from '@/lib/platform';

export default function PushDebugOverlay() {
  const [open, setOpen] = useState(false);
  const [pushDebug, setPushDebug] = useState<string | null>(null);
  const [convDebug, setConvDebug] = useState<string | null>(null);
  const [navTrail, setNavTrail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    refresh();
    setReady(true);
  }, []);

  function refresh() {
    try {
      setPushDebug(window.localStorage.getItem('sv_last_push_action_debug'));
      setConvDebug(window.localStorage.getItem('sv_last_conv_deeplink_debug'));
      setNavTrail(window.localStorage.getItem('sv_nav_trail_debug'));
    } catch {
      /* ignore */
    }
  }

  function clearAll() {
    try {
      window.localStorage.removeItem('sv_last_push_action_debug');
      window.localStorage.removeItem('sv_last_conv_deeplink_debug');
      window.localStorage.removeItem('sv_nav_trail_debug');
    } catch {
      /* ignore */
    }
    setPushDebug(null);
    setConvDebug(null);
    setNavTrail(null);
  }

  if (!isNativeApp() || !ready) return null;

  return (
    <div style={{ position: 'fixed', bottom: 90, right: 12, zIndex: 999999 }}>
      <button
        type="button"
        onClick={() => { refresh(); setOpen((o) => !o); }}
        aria-label="Push debug"
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          background: pushDebug || convDebug ? '#dc2626' : '#1b1b1b',
          color: '#fff',
          border: 'none',
          fontSize: 18,
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        }}
      >
        🐞
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            left: 12,
            right: 12,
            bottom: 144,
            maxHeight: '62vh',
            overflowY: 'auto',
            background: '#0b0b0b',
            color: '#7CFC91',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 11,
            lineHeight: 1.5,
            padding: 14,
            borderRadius: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            border: '1px solid #333',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ color: '#fff', fontWeight: 700, marginBottom: 6, fontSize: 12 }}>
            🔔 Push tap → data.url
          </div>
          <div>{pushDebug ? formatJson(pushDebug) : '(no tap captured yet — tap a notification, then reopen this)'}</div>

          <div style={{ color: '#fff', fontWeight: 700, marginTop: 14, marginBottom: 6, fontSize: 12 }}>
            💬 Conversations page → URL seen on mount
          </div>
          <div>{convDebug ? formatJson(convDebug) : '(not visited yet)'}</div>

          <div style={{ color: '#fff', fontWeight: 700, marginTop: 14, marginBottom: 6, fontSize: 12 }}>
            🧭 Navigation trail (last 15 routes)
          </div>
          <div>{navTrail ? formatJson(navTrail) : '(none yet)'}</div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              onClick={refresh}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8, background: '#374151',
                color: '#fff', border: 'none', fontSize: 12, fontFamily: 'inherit',
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={clearAll}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8, background: '#7f1d1d',
                color: '#fff', border: 'none', fontSize: 12, fontFamily: 'inherit',
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
