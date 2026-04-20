'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Heart } from 'lucide-react';

const APP = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';

export function SaveToWishlistButton({ venueSlug }: { venueSlug: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    setMsg(null);
    setBusy(true);
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) {
        setMsg('Configuration error');
        return;
      }
      const supabase = createClient(url, anon);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        window.location.href = `${APP.replace(/\/$/, '')}/couple/login?next=${encodeURIComponent(`/venue/${venueSlug}`)}`;
        return;
      }
      const res = await fetch(`${APP.replace(/\/$/, '')}/api/couple/wishlist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slug: venueSlug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(typeof data.error === 'string' ? data.error : 'Could not save');
        return;
      }
      setMsg('Saved to your wish list');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:border-gray-300 disabled:opacity-60"
      >
        <Heart className="h-4 w-4" />
        {busy ? 'Saving…' : 'Save to wish list'}
      </button>
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  );
}
