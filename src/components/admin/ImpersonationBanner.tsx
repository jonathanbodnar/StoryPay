'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, LogOut, Loader2 } from 'lucide-react';

export default function ImpersonationBanner({ venueName }: { venueName: string }) {
  const [loading, setLoading] = useState(false);
  const [exitLabel, setExitLabel] = useState('Exit to admin');

  // Derive a friendly label from the return URL stored server-side.
  // We read it from a lightweight status endpoint to avoid exposing httpOnly cookies.
  useEffect(() => {
    fetch('/api/admin/impersonate/status', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((d: { returnUrl?: string } | null) => {
        if (!d?.returnUrl) return;
        if (d.returnUrl.includes('/admin/venues')) setExitLabel('Exit to venue management');
        else if (d.returnUrl.includes('/admin/support')) setExitLabel('Exit to support inbox');
        else setExitLabel('Exit to admin');
      })
      .catch(() => {});
  }, []);

  async function exit() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/impersonate/exit', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      window.location.href = data.redirect || '/admin/venues';
    } catch {
      window.location.href = '/admin/venues';
    }
  }

  return (
    <div className="fixed top-0 inset-x-0 z-[200] flex items-center justify-between gap-3 bg-gray-900 px-4 py-2 text-white shadow-lg">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck size={15} className="text-emerald-400 shrink-0" />
        <span className="text-gray-300">Viewing as</span>
        <span className="font-semibold truncate">{venueName}</span>
      </div>
      <button
        onClick={() => void exit()}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20 transition-colors shrink-0 disabled:opacity-50"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
        {exitLabel}
      </button>
    </div>
  );
}
