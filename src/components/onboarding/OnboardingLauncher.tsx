'use client';

/**
 * In-flow "Finish setup" launcher rendered at the top-left of the dashboard
 * content (inside <main>, under the announcement ribbon) so it lines up exactly
 * with the page. Stays until onboarding is complete; clicking it opens the
 * wizard modal (owned by OnboardingWizard) via a window event.
 */

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

const BRAND = '#1b1b1b';

export default function OnboardingLauncher() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // If the wizard was explicitly restarted (?onboarding=1 in URL), always
        // show the launcher — the restart action clears `completed` but the venue
        // may still be published+guide_enabled, which would otherwise hide us.
        const forced = new URLSearchParams(window.location.search).get('onboarding') === '1';
        if (forced) { setShow(true); return; }

        const res = await fetch('/api/onboarding/state', { cache: 'no-store' });
        if (!res.ok) return;
        const s = await res.json();
        if (cancelled) return;
        const complete = Boolean(s.completed) || (Boolean(s.is_published) && Boolean(s.guide_enabled));
        setShow(!complete);
      } catch { /* ignore */ }
    })();
    const onComplete = () => setShow(false);
    window.addEventListener('storyvenue:setup-complete', onComplete);
    return () => {
      cancelled = true;
      window.removeEventListener('storyvenue:setup-complete', onComplete);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="group relative mb-4 self-start">
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('storyvenue:open-setup'))}
        className="flex items-center gap-2 rounded-full py-2.5 pl-3 pr-4 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.03]"
        style={{ backgroundColor: BRAND }}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15">
          <Sparkles size={14} />
        </span>
        Finish setup
      </button>
      <div className="pointer-events-none absolute top-full left-0 z-20 mt-2 w-60 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        Publish your booking system to start getting leads. This goes away once your listing and guide are live.
      </div>
    </div>
  );
}
