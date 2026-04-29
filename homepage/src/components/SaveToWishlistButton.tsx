'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Heart } from 'lucide-react';

const APP = (process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com').replace(/\/$/, '');

/**
 * Save / un-save toggle for a venue listing.
 *
 *  - Signed-in couples: clicking toggles the save in-place via AJAX. No
 *    redirects so the user can browse and save many venues quickly.
 *  - Signed-out visitors: first click jumps to the couple login with a
 *    `next` param that returns to the venue page after sign-in. We don't
 *    auto-save after login here — couples can simply click again from
 *    their session.
 */
export function SaveToWishlistButton({ venueSlug }: { venueSlug: string }) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [flash, setFlash] = useState<'saved' | 'removed' | 'error' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Fetch initial saved status from the API. We do this through the API so
  // a single source of truth (auth + saved status) is consulted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !anon) {
          if (!cancelled) setSignedIn(false);
          return;
        }
        const supabase = createClient(url, anon);
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          if (!cancelled) setSignedIn(false);
          return;
        }
        const res = await fetch(
          `${APP}/api/couple/wishlist/check?slug=${encodeURIComponent(venueSlug)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' },
        );
        if (!res.ok) {
          if (!cancelled) setSignedIn(true);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setSignedIn(Boolean(data?.signed_in));
        setSaved(Boolean(data?.saved));
      } catch {
        if (!cancelled) setSignedIn(null);
      }
    })();
    return () => { cancelled = true; };
  }, [venueSlug]);

  function showFlash(kind: 'saved' | 'removed' | 'error') {
    setFlash(kind);
    setTimeout(() => setFlash(null), 2000);
  }

  async function onClick() {
    if (busy) return;
    setErrorMsg('');
    setBusy(true);
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) {
        setErrorMsg('Configuration error');
        showFlash('error');
        return;
      }
      const supabase = createClient(url, anon);
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        // Not signed in — bounce to the couple login with a return URL
        // pointing at this venue page. (Cross-origin redirects from the
        // login flow are validated app-side.)
        const next = `/venue/${venueSlug}`;
        window.location.href = `${APP}/couple/login?next=${encodeURIComponent(next)}`;
        return;
      }

      // Optimistic UI: flip immediately
      const prev = saved;
      setSaved(!prev);

      const res = await fetch(`${APP}/api/couple/wishlist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slug: venueSlug, action: 'toggle' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaved(prev); // revert
        setErrorMsg(typeof data.error === 'string' ? data.error : 'Could not save');
        showFlash('error');
        return;
      }
      // Server is the authority for final state
      const finalSaved = Boolean(data?.saved);
      setSaved(finalSaved);
      showFlash(finalSaved ? 'saved' : 'removed');
    } finally {
      setBusy(false);
    }
  }

  // Visual: filled red heart when saved, outline + dark text when not
  const label = saved ? 'Saved' : 'Save to wish list';
  const flashLabel =
    flash === 'saved' ? 'Saved to your wish list'
    : flash === 'removed' ? 'Removed from wish list'
    : flash === 'error' ? (errorMsg || 'Could not save')
    : null;

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy || signedIn === null}
        aria-pressed={saved}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-150 disabled:opacity-60 ${
          saved
            ? 'border-red-200 bg-red-50 text-red-700 hover:border-red-300'
            : 'border-gray-200 bg-white text-gray-800 hover:border-gray-300'
        }`}
      >
        <Heart
          className={`h-4 w-4 transition-colors ${saved ? 'fill-red-500 text-red-500' : ''}`}
          strokeWidth={saved ? 0 : 2}
        />
        {label}
      </button>
      {flashLabel && (
        <p className={`text-xs ${flash === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
          {flashLabel}
        </p>
      )}
    </div>
  );
}
